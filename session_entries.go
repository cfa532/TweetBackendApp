// session_entries.go — who is calling.
//
// Every object here is created and written under the application author's
// identity, so the node itself cannot tell one user's request from another's:
// the userid a request names is a claim. What turns the claim into something
// checked is a Leither login session. The client signs in to the node itself —
// an owner with the key their device was paired with, a guest with the
// username and password Leither holds for them — and passes the session it was
// given as "usersid". The node resolves that session to a Leither user id, and
// each account records the one that controls it (authUid).
//
// The parameter is not "sid": that name carries the application author's
// session between entries and between nodes (callEntry, callRemote), and a
// user's session must never be mistaken for it or replaced by it.
//
// Two kinds of user exist, and they differ in how they come to hold a session:
//
//   - An owner has access to the machine. They run tweet-owner.sh on it, which
//     creates a Leither key, lists its user id in tweet.node.json, and prints
//     the identity for the app to scan or import. There can be several.
//   - A guest uses the node by the owner's courtesy. They register a username
//     and password with Leither on this node; neither is stored in the account.
//
// A Leither session is held in node memory for an hour, and is lost when the
// node restarts. A client told its session is invalid signs in again and
// repeats the request, which is safe because the check runs before any write.
package lapp

import (
	"fmt"
	"os"
	"strings"
)

// reqUserSid names the request parameter carrying the caller's Leither session.
const reqUserSid = "usersid"

// errSessionInvalid is the message for a session this node does not recognise.
// Clients match on it to decide to sign in again, so it is part of the
// contract.
const errSessionInvalid = "Session invalid"

// nodeConfigFile sits beside the Leither executable. Only someone with access
// to the machine can write it, which is exactly what makes them an owner.
const nodeConfigFile = "tweet.node.json"

// ownerSessionRequired decides what a write without a verified caller means.
//
// While it is false such a write is performed as before, which keeps released
// clients and accounts that predate authUid working during the migration.
// Switch it to true once every client signs in to Leither and every account
// has been bound; from then on the calling user is always verified. It is a
// function because package-level variables are not initialised by the node's
// interpreter (see main.go).
func ownerSessionRequired() bool { return false }

// callerUID resolves the request's user session to a Leither user id. It is
// empty, without an error, when the request carries no session at all.
func (c *ctx) callerUID() (string, error) {
	sid := c.str(reqUserSid)
	if sid == "" {
		return "", nil
	}
	value, err := c.api.GetVar(sid, "userid")
	uid := toString(value)
	if err != nil || uid == "" {
		c.warnf("unknown user session: %v", err)
		return "", fmt.Errorf(errSessionInvalid)
	}
	return uid, nil
}

// requireOwner rejects a write whose caller does not control the account that
// owns the data. ownerID is the account the entry is about to write to.
func (c *ctx) requireOwner(ownerID string) error {
	callerUID, err := c.callerUID()
	if err != nil {
		return err
	}
	if callerUID == "" {
		if ownerSessionRequired() {
			return fmt.Errorf(errSessionInvalid)
		}
		return nil
	}
	owner, err := c.loadUser(ownerID)
	if err != nil {
		return err
	}
	if owner == nil {
		return fmt.Errorf("User not found")
	}
	if owner.authUID() == "" {
		// An account created before sessions existed has nothing to compare
		// against until its user signs in once and binds it (see login).
		if ownerSessionRequired() {
			return fmt.Errorf("Account %s is not bound to an identity; sign in again", ownerID)
		}
		return nil
	}
	if owner.authUID() != callerUID {
		c.errorf("write refused %s", jsonStringify(map[string]any{
			"callerUid": callerUID, "ownerId": ownerID,
		}))
		return fmt.Errorf("This session does not own account %s", ownerID)
	}
	return nil
}

// requirePeerCall rejects a caller that is not this application acting from
// the expected node. The entries that write a node's own data on a peer's
// behalf (apply_comment, remove_comment) are not part of the client surface,
// and a request reaches them in one of two forms:
//
//   - Local delegation, an in-process callEntry from another entry of this
//     app. The caller carries the local author login session in sid, and the
//     node injects the app record's author uid as the "author" request key
//     (overwriting any caller-supplied value). A client cannot obtain an
//     author session: BELoginAsAuthor is not on the RPC surface.
//   - Cross-node, forwarded by RunMApp. The forwarding node deletes sid
//     before the request leaves it and the target runs the entry as guest;
//     what the platform does inject is a nodeappcode minted here under the
//     calling node's transport session, so SessionGet(code, "nodeid") names
//     the calling node. A code minted by an ordinary logged-in user names
//     that user instead, which is why the resolved node must be the one this
//     entry expects: the delegating node, the user's own root.
//
// What this still does not do: a code leaked from the expected node is a
// bearer credential for its remaining lifetime (about an hour), and the
// check trusts the expected node itself, which is the documented residual.
func (c *ctx) requirePeerCall(expectedNodeID string) error {
	const errNotPeer = "Not called from a peer node"
	if callerSid := c.sid(); callerSid != "" {
		value, err := c.api.GetVar(callerSid, "userid")
		callerUID := toString(value)
		authorUID := c.str("author")
		if err != nil || callerUID == "" || authorUID == "" || callerUID != authorUID {
			c.warnf("peer call under a session that is not the app author")
			return fmt.Errorf(errNotPeer)
		}
		return nil
	}
	if code := c.str("nodeappcode"); code != "" {
		friendID, err := c.friendByAppCode(code, "")
		if err != nil {
			c.warnf("peer call with an unresolvable node app code: %v", err)
			return fmt.Errorf(errNotPeer)
		}
		if friendID == "" || friendID != expectedNodeID {
			c.errorf("peer call from node %s, expected %s", friendID, expectedNodeID)
			return fmt.Errorf(errNotPeer)
		}
		return nil
	}
	return fmt.Errorf(errNotPeer)
}

// ---------------------------------------------------------------------------
// Node configuration
// ---------------------------------------------------------------------------

// nodeConfig is what the people with access to this machine have decided
// about it.
type nodeConfig struct {
	// allowGuests says whether someone without an owner identity may register
	// an account here. Owners permit it unless they say otherwise.
	allowGuests bool
	// owners maps a Leither user id to the username of the account it controls.
	owners map[string]string
}

// loadNodeConfig reads tweet.node.json. A node that has no such file has no
// owners and accepts guests, which is how every node behaved before.
func (c *ctx) loadNodeConfig() (nodeConfig, error) {
	config := nodeConfig{allowGuests: true, owners: map[string]string{}}
	path := nodeConfigPath()
	if path == "" {
		return config, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return config, fmt.Errorf("read %s: %v", nodeConfigFile, err)
	}
	parsed, err := jsonParseObject(string(data))
	if err != nil {
		return config, fmt.Errorf("invalid %s: %v", nodeConfigFile, err)
	}
	if has(parsed, "allowGuestRegistration") {
		config.allowGuests = mapBool(parsed, "allowGuestRegistration")
	}
	if owners, ok := toMap(parsed["owners"]); ok {
		for uid, value := range owners {
			if record, ok := toMap(value); ok {
				if username := mapStr(record, "username"); username != "" {
					config.owners[uid] = username
				}
			}
		}
	}
	return config, nil
}

// nodeConfigPath finds tweet.node.json in the Leither root, which is where the
// executable lives and normally also the working directory. Empty when the
// file does not exist.
func nodeConfigPath() string {
	directories := []string{}
	if executable, err := os.Executable(); err == nil {
		if cut := strings.LastIndexAny(executable, "/\\"); cut > 0 {
			directories = append(directories, executable[:cut])
		}
	}
	if working, err := os.Getwd(); err == nil {
		directories = append(directories, working)
	}
	for _, directory := range directories {
		path := directory + "/" + nodeConfigFile
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// Signing in with a session
// ---------------------------------------------------------------------------

// sessionLogin answers login for a caller who has already signed in to
// Leither on this node, and returns the account that session controls.
//
// An owner names no account: tweet.node.json says which username their
// identity was issued for, and the account is created on first sign-in, which
// is what pairing a device amounts to. A guest names their username, and the
// account must already be bound to their Leither user.
//
// An account that predates sessions has no identity yet. Its user proves
// ownership one last time with the password stored in the account, and it is
// bound to the session's user from then on. The stored password is left in
// place so clients that have not been updated can still sign in.
func (c *ctx) sessionLogin() (any, error) {
	callerUID, err := c.callerUID()
	if err != nil {
		return c.wrapErrStatus(err), nil
	}
	config, err := c.loadNodeConfig()
	if err != nil {
		return c.wrapErrStatus(err), nil
	}
	username, isOwner := config.owners[callerUID]
	if !isOwner {
		username = c.str("username")
	}
	if !validUsername(username) {
		return c.wrapErrStatus(fmt.Errorf("User not found")), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrStatus(err), nil
	}
	userID, exists, err := c.resolveUserName(authSid, username)
	if err != nil {
		return c.wrapErrStatus(err), nil
	}

	var user userObj
	if !exists {
		if !isOwner {
			return c.wrapErrStatus(fmt.Errorf("User not found")), nil
		}
		user = userObj{"username": username, "name": username, "authUid": callerUID}
		if err := c.createAccount(authSid, userID, user); err != nil {
			return c.wrapErrStatus(err), nil
		}
	} else {
		user, err = c.storedUser(authSid, userID)
		if err != nil {
			return c.wrapErrStatus(err), nil
		}
		if user.authUID() != callerUID {
			if err := c.bindAccount(authSid, user, callerUID, isOwner); err != nil {
				return c.wrapErrStatus(err), nil
			}
		}
	}

	if user.hostID() == c.nodeID() {
		user["lastLogin"] = nowMillis()
		if err := c.recordLogin(authSid, userID, user); err != nil {
			c.errorf("%v, loginOK=true, user=%s", err, user.username())
		}
	}
	// The account goes out through get_user_core_data, like every other entry
	// that returns one. Clients decode that shape; a record handed back as it
	// was just written carries its timestamps as int64, which the clients'
	// transport delivers as text.
	account, err := c.callEntryMap("get_user_core_data", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
	})
	if err != nil {
		return c.wrapErrStatus(err), nil
	}
	if account == nil {
		return c.wrapErrStatus(fmt.Errorf("User not found")), nil
	}
	return c.wrapStatus(map[string]any{
		"user":   account,
		"status": "success",
		"owner":  isOwner,
	}), nil
}

// storedUser reads an account's committed record.
func (c *ctx) storedUser(authSid, userID string) (userObj, error) {
	readSid, err := c.openMimei(authSid, userID, verLast)
	if err != nil {
		return nil, err
	}
	stored, err := c.getObject(readSid, ownerDataKey)
	c.closeMimei(readSid)
	if err != nil {
		return nil, err
	}
	if stored == nil {
		return nil, fmt.Errorf("User not found")
	}
	return userObj(stored), nil
}

// bindAccount records callerUID as the identity controlling an existing
// account. It changes who may write to the account, so it happens only on the
// account's root node and only on one of two grounds: the people running this
// node issued the identity for this username, or the caller supplied the
// password of an account that has no identity yet.
func (c *ctx) bindAccount(authSid string, user userObj, callerUID string, isOwner bool) error {
	if err := c.requireRootNodeFor(user, user.mid()); err != nil {
		return err
	}
	if !isOwner {
		if user.authUID() != "" {
			return fmt.Errorf("This session does not own account %s", user.mid())
		}
		expected, err := c.contentID(authSid, c.str("password"))
		if err != nil {
			return err
		}
		if c.str("password") == "" || user.password() != expected {
			return fmt.Errorf("Wrong password")
		}
	}
	user["authUid"] = callerUID
	c.infof("account %s bound to identity %s (owner=%t)", user.mid(), callerUID, isOwner)
	return nil
}
