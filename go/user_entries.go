// user_entries.go — account creation, authentication and profile reads.
//
// A user account is a Mimei database whose id is derived from the username, so
// the same name always maps to the same id on every node and a name can be
// claimed exactly once. The account object lives in that database under
// ownerDataKey, and the database also holds the user's tweet list, social graph
// and engagement lists.
//
// Accounts are owned by one node. user.hostIds[0] names it, and every write to
// the account belongs there — but choosing that node is the client's job. These
// entries write to whichever node they are called on, and only refuse when the
// account is unknown here.
package lapp

import (
	"fmt"
	"strings"
)

// maxUsernameLen bounds a username, which also bounds the id derived from it.
const maxUsernameLen = 20

// validUsername reports whether a name is made only of characters that are safe
// in an id and in a URL: letters, digits, underscore and hyphen.
func validUsername(name string) bool {
	if name == "" || len(name) > maxUsernameLen {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

// userIDForName derives a user's id from their username. MMCreate is
// deterministic in its mark, so this both creates the account database and, for
// an existing name, returns the id already in use.
func (c *ctx) userIDForName(authSid, username string) (string, error) {
	return c.createDatabase(authSid, username)
}

// cleanHostIDs drops empty and blank entries from a hostIds array.
func cleanHostIDs(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if strings.TrimSpace(id) != "" {
			out = append(out, id)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

// entryRegister creates an account.
//
// The account is created on the node handling the request; clients pick their
// home node and call it directly. The derived id is checked for an existing
// provider before anything is written — that check is what makes usernames
// unique across the network.
func entryRegister(c *ctx) (any, error) {
	// register predates the version parameter and treats its absence as v2.
	enveloped := c.version() == "" || c.isV2()
	fail := func(err error) any {
		c.errorf("%v, request=%s", err, c.requestJSON())
		if enveloped {
			return respErr(err)
		}
		return map[string]any{"status": "failure", "reason": err.Error()}
	}

	if c.appID() == "" {
		return fail(fmt.Errorf("Missing application ID")), nil
	}
	if !c.has("user") {
		return fail(fmt.Errorf("Missing user data")), nil
	}
	raw, err := c.obj("user")
	if err != nil {
		c.errorf("Invalid user JSON: %s", redactParam("user", c.str("user")))
		return fail(fmt.Errorf("Invalid user data format")), nil
	}
	user := userObj(raw)

	if !validUsername(user.username()) {
		return fail(fmt.Errorf("Invalid username format")), nil
	}
	user["hostIds"] = strSlice(cleanHostIDs(user.hostIDs()))

	nodeID := c.nodeID()
	c.debugf("nodeId=%s, user=%s", nodeID, redactParam("user", c.str("user")))

	// The account is created here. Clients pick the node they want to register
	// on and call it directly, so a request that arrives here is meant for here.
	authSid, err := c.authSid()
	if err != nil {
		return fail(err), nil
	}
	userMid, err := c.userIDForName(authSid, user.username())
	if err != nil {
		c.errorf("Failed to create user MID for %s: %v", user.username(), err)
		return fail(fmt.Errorf("Failed to create user account")), nil
	}

	// An existing provider for the derived id means the name is already in use
	// somewhere on the network.
	providerIP, err := c.callEntry("get_provider_ip", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		reqMID:    userMid,
	})
	if err != nil {
		c.errorf("Failed to check provider for user %s: %v", user.username(), err)
		return fail(fmt.Errorf("Failed to validate username uniqueness")), nil
	}
	if ip := toString(providerIP); ip != "" {
		c.errorf("User register failed. Existing %s at %s", user.username(), ip)
		return fail(fmt.Errorf("Username is taken")), nil
	}

	user["mid"] = userMid

	// The password is not stored. A content-addressed Mimei id derived from it
	// is, and login re-derives that id to compare.
	hashed, err := c.contentID(authSid, user.password())
	if err != nil {
		c.errorf("Failed to hash password for user %s: %v", user.username(), err)
		return fail(fmt.Errorf("Failed to process password")), nil
	}
	user["password"] = hashed

	now := nowMillis()
	user["timestamp"] = now
	user["lastLogin"] = now
	user["name"] = strings.TrimSpace(user.name())
	user["profile"] = strings.TrimSpace(user.profile())
	user["cloudDrivePort"] = mapInt(user, "cloudDrivePort", 0)

	if hosts := cleanHostIDs(user.hostIDs()); len(hosts) == 0 {
		user["hostIds"] = strSlice([]string{nodeID})
	} else {
		user["hostIds"] = strSlice(hosts)
	}

	userSid, err := c.api.MMOpen(authSid, userMid, verCur)
	if err != nil {
		c.errorf("Failed to open user storage for %s: %v", user.username(), err)
		return fail(fmt.Errorf("Failed to create user storage")), nil
	}
	defer c.closeMimei(userSid)

	if err := c.setValue(userSid, ownerDataKey, map[string]any(user)); err != nil {
		c.errorf("Failed to save user data for %s: %v", user.username(), err)
		return fail(fmt.Errorf("Failed to save user data")), nil
	}
	if err := c.backupDelRef(userSid, userMid, ""); err != nil {
		return fail(err), nil
	}
	// Publishing is what lets toggle_following on another node find the account.
	if err := c.mimeiPublish(authSid, userMid); err != nil {
		c.warnf("publish %s failed: %v", userMid, err)
	}
	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userMid,
		reqMID:    userMid,
	}); err != nil {
		c.warnf("node_update_score failed: %v", err)
	}

	c.debugf("User registered %s", jsonStringify(map[string]any(user)))
	user.stripPassword()
	// The account is returned as a JSON string, which is the shape the clients
	// parse.
	return c.registerReply(enveloped, map[string]any{
		"user":   jsonStringify(map[string]any(user)),
		"status": "success",
	}), nil
}

// registerReply shapes a registration result. A successful reply carries the
// account as a parsed object for enveloped callers and as the original string
// for legacy ones.
func (c *ctx) registerReply(enveloped bool, result map[string]any) any {
	if !enveloped {
		return result
	}
	if mapStr(result, "status") == "success" && has(result, "user") {
		userValue := result["user"]
		if parsed, ok := toMap(userValue); ok {
			userValue = parsed
		}
		return map[string]any{"success": true, "user": userValue}
	}
	if _, ok := result["success"]; ok {
		return result
	}
	if has(result, "status") {
		out := map[string]any{"success": mapStr(result, "status") == "success"}
		for k, v := range result {
			out[k] = v
		}
		return out
	}
	return respOK(result)
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

// entryLogin authenticates a username and password.
//
// The account id is derived from the username, so no lookup table is needed;
// the password is checked by re-deriving its content id and comparing. The
// lastLogin write lands on whichever node the client called.
func entryLogin(c *ctx) (any, error) {
	username := c.str("username")
	password := c.str("password")

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrStatus(err), nil
	}
	userID, err := c.userIDForName(authSid, username)
	if err != nil {
		return c.wrapErrStatus(err), nil
	}

	readSid, err := c.api.MMOpen(authSid, userID, verLast)
	if err != nil {
		return c.wrapErrStatus(err), nil
	}
	stored, err := c.getObject(readSid, ownerDataKey)
	c.closeMimei(readSid)
	if err != nil {
		return c.wrapErrStatus(err), nil
	}
	if stored == nil {
		c.errorf("User not found for username: %s %s", username, userID)
		return c.wrapErrStatus(fmt.Errorf("User not found")), nil
	}
	user := userObj(stored)

	expected, err := c.contentID(authSid, password)
	if err != nil {
		return c.wrapErrStatus(err), nil
	}
	if user.password() != expected {
		return c.wrapErrStatus(fmt.Errorf("Wrong password")), nil
	}

	// Authenticated from here on. A failure while recording the login must not
	// turn a valid login into a rejection, so the remaining errors fall through
	// to returning the account.
	now := nowMillis()
	user["lastLogin"] = now
	c.debugf("user=%s", user.username())

	// A creation timestamp that is absent, non-positive, in the future, or more
	// than two years before this login is not usable for ordering; fall back to
	// the login time.
	const twoYearsMillis = int64(2 * 365 * 24 * 60 * 60 * 1000)
	created := mapInt(user, "timestamp", 0)
	if created <= 0 || created > now || created < now-twoYearsMillis {
		user["timestamp"] = now
	}

	if err := c.recordLogin(authSid, userID, user); err != nil {
		c.errorf("%v, loginOK=true, user=%s", err, user.username())
	}

	user.stripPassword()
	c.debugf("login succeeded: user=%s", jsonStringify(map[string]any(user)))
	return c.wrapStatus(map[string]any{
		"user":   map[string]any(user),
		"status": "success",
	}), nil
}

// recordLogin persists the updated lastLogin and republishes the account.
func (c *ctx) recordLogin(authSid, userID string, user userObj) error {
	mid := user.mid()
	if mid == "" {
		mid = userID
	}
	userSid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", userID, err)
	}
	defer c.closeMimei(userSid)

	if err := c.setValue(userSid, ownerDataKey, map[string]any(user)); err != nil {
		return err
	}
	if err := c.backupDelRef(authSid, mid, ""); err != nil {
		return err
	}
	if err := c.mimeiPublish(authSid, mid); err != nil {
		c.warnf("publish %s failed: %v", mid, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// get_userid
// ---------------------------------------------------------------------------

// entryGetUserID returns the account id a username maps to, without requiring
// the account to exist. Clients use it to address a user before they have
// fetched their profile.
func entryGetUserID(c *ctx) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	userID, err := c.userIDForName(authSid, c.str("username"))
	if err != nil {
		return c.wrapErr(err), nil
	}
	return c.wrapNotNull(userID, "Failed to generate user ID"), nil
}

// ---------------------------------------------------------------------------
// get_user_core_data
// ---------------------------------------------------------------------------

// entryGetUserCoreData reads the account this node holds, with the engagement
// counts computed from its lists. It is a local read only: an absent account
// means this node has no copy, and finding one elsewhere is get_user's job.
func entryGetUserCoreData(c *ctx) (any, error) {
	userID := c.str("userid")
	nodeID := c.nodeID()

	var result map[string]any
	err := c.readMimei("", userID, func(mmsid string) error {
		stored, err := c.getObject(mmsid, ownerDataKey)
		if err != nil {
			return err
		}
		if stored == nil {
			c.errorf("User %s not found on node %s", userID, nodeID)
			return nil
		}
		user := userObj(stored)

		// hostIds is reported as [root node, this node] so the client knows both
		// where the account is authoritative and where this copy came from.
		root := user.hostID()
		user["hostIds"] = strSlice([]string{root, nodeID})

		counts := []struct {
			field string
			key   string
			zset  bool
		}{
			{"tweetCount", userTweetList, true},
			{"followingCount", userFollowingsList, false},
			{"followersCount", userFollowersList, false},
			{"bookmarksCount", userBookmarkList, false},
			{"favoritesCount", userFavoriteList, false},
			{"commentsCount", userCommentList, false},
		}
		for _, spec := range counts {
			var n int64
			var err error
			if spec.zset {
				n, err = c.zcard(mmsid, spec.key)
			} else {
				n, err = c.hlen(mmsid, spec.key)
			}
			if err != nil {
				return err
			}
			user[spec.field] = n
		}

		user.stripPassword()
		result = map[string]any(user)
		return nil
	})
	if err != nil {
		return c.wrapErr(err), nil
	}
	if result == nil {
		return c.wrapNotNull(nil, "User not found"), nil
	}
	c.debugf("user=%s", jsonStringify(result))
	return c.wrapNotNull(result, "User not found"), nil
}

// ---------------------------------------------------------------------------
// get_user
// ---------------------------------------------------------------------------

// entryGetUser reads an account, falling back to a network location when this
// node has no copy.
//
// For v3 clients the fallback is omitted: they treat an absent account as
// absent and do their own recovery through resync_user, rather than following
// an address to another node.
func entryGetUser(c *ctx) (any, error) {
	userID := c.str("userid")

	user, err := c.callEntry("get_user_core_data", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
	})
	if err != nil {
		return c.wrapErrAlways(err), nil
	}
	if user != nil {
		return c.alwaysOK(user, "User not found"), nil
	}
	if c.isV3() {
		return c.alwaysOK(nil, "User not found"), nil
	}

	ip, err := c.callEntry("get_provider_ip", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		reqMID:    userID,
	})
	if err != nil {
		return c.wrapErrAlways(err), nil
	}
	if addr := toString(ip); addr != "" {
		c.debugf("new ip %s", addr)
		return c.alwaysOK(addr, "User not found"), nil
	}
	return c.wrapErrAlways(fmt.Errorf("No provider IP found.")), nil
}

// ---------------------------------------------------------------------------
// sync_user
// ---------------------------------------------------------------------------

// entrySyncUser pulls an account's current data from its root node onto this
// one. It is the low-level half of resync_user.
func entrySyncUser(c *ctx) (any, error) {
	if err := c.mimeiSync(c.str(reqMID), nil); err != nil {
		return c.wrapErr(err), nil
	}
	return c.wrap(map[string]any{"success": true}), nil
}

// ---------------------------------------------------------------------------
// resync_user
// ---------------------------------------------------------------------------

// entryResyncUser refreshes an account from its root node and returns it.
//
// This is an explicit recovery path, not a routine read: clients attach it to
// pull-to-refresh. Synchronising a user carries that user's directly referenced
// tweets, which is why v3 can return them alongside the account; it does not
// carry those tweets' comments, so a client still loads those separately.
func entryResyncUser(c *ctx) (any, error) {
	userID := c.str("userid")
	appUserID := firstNonEmpty(c.str("appuserid"), c.str("author"), userID)

	user, err := c.loadUser(userID)
	if err != nil {
		return c.wrapErrV23(err), nil
	}
	nodeID := c.nodeID()
	if user == nil || !user.hasValidHost() {
		c.errorf("missing host for user %s", jsonStringify(map[string]any{
			"userId": userID, "nodeId": nodeID,
		}))
		return c.wrapErrV23(fmt.Errorf("User not found or missing host")), nil
	}
	rootHost := user.hostID()
	c.debugf("start userId=%s nodeId=%s hostIds=%s version=%s",
		userID, nodeID, jsonStringify(strSlice(user.hostIDs())), c.version())

	tweets := []any{}
	syncErr := ""

	// Only an access node has anything to pull. On the root node there is no
	// other copy to synchronise from.
	if rootHost != nodeID {
		c.debugf("syncing user mid userId=%s hostId=%s", userID, rootHost)
		// Asked for in v2 so a failure arrives as a message rather than as an
		// absent value: node_update_mid_by_score handles its own errors, so this
		// result is the only account of whether the sync ran.
		syncResult, err := c.callEntryMap("node_update_mid_by_score", map[string]string{
			reqAppID:   c.appID(),
			reqAppVer:  verLast,
			reqVersion: versionV2,
			"hostid":   rootHost,
			"userid":   userID,
			reqMID:     userID,
		})
		switch {
		case err != nil:
			syncErr = err.Error()
		case syncResult == nil:
			syncErr = "node_update_mid_by_score returned no result"
		case !mapBool(syncResult, "success"):
			if msg := mapStr(syncResult, "message"); msg != "" {
				syncErr = msg
			} else {
				syncErr = "node_update_mid_by_score returned no result"
			}
		}
		if syncErr != "" {
			// Not fatal by itself: an earlier sync may have left a usable copy
			// here. Reading it below decides whether this matters.
			c.errorf("sync failed userId=%s hostId=%s: %s", userID, rootHost, syncErr)
		}

		if c.isV3() {
			// Collecting tweets is isolated because the account is what recovery
			// is for; failing to list its tweets must not discard an account that
			// synchronised cleanly.
			collected, err := c.collectRecentTweets(userID, appUserID)
			if err != nil {
				c.errorf("v3: tweet collection failed userId=%s: %v", userID, err)
			} else {
				tweets = collected
			}
			c.debugf("v3: tweet sync done userId=%s synced=%d", userID, len(tweets))
		}
	}

	userData, err := c.callEntry("get_user_core_data", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
	})
	if err != nil {
		return c.wrapErrV23(err), nil
	}
	if userData == nil {
		c.errorf("get_user_core_data returned null userId=%s", userID)
		// With no local copy to fall back on, a sync failure is the reason there
		// is nothing to return and the only detail the caller can act on.
		if syncErr != "" {
			return c.wrapErrV23(fmt.Errorf("Failed to synchronize user from %s: %s", rootHost, syncErr)), nil
		}
		return c.wrapErrV23(fmt.Errorf("Failed to retrieve user data after synchronization")), nil
	}

	c.debugf("done userId=%s version=%s tweets=%d", userID, c.version(), len(tweets))
	if c.isV3() {
		return c.wrap(map[string]any{"user": userData, "tweets": tweets}), nil
	}
	return c.wrapNotNull(userData, "User not found"), nil
}

// collectRecentTweets reads the newest tweets now present on this node for a
// user, as they stand after synchronisation.
func (c *ctx) collectRecentTweets(userID, appUserID string) ([]any, error) {
	const recentTweetCount = 20

	var ids []string
	err := c.readMimei("", userID, func(mmsid string) error {
		pairs, err := c.zrevrange(mmsid, userTweetList, 0, recentTweetCount-1)
		if err != nil {
			return err
		}
		ids = members(pairs)
		return nil
	})
	if err != nil {
		return nil, err
	}
	c.debugf("v3: userId=%s tweetIdList.length=%d", userID, len(ids))

	tweets := []any{}
	for _, tweetID := range ids {
		if tweetID == "" {
			c.debugf("v3: skipping empty element userId=%s", userID)
			continue
		}
		tweet, err := c.callEntry("get_tweet", map[string]string{
			reqAppID:    c.appID(),
			reqAppVer:   verLast,
			"tweetid":   tweetID,
			"appuserid": appUserID,
			reqVersion:  versionV3,
		})
		if err != nil || tweet == nil {
			c.debugf("v3: tweet not local, skipping tweetId=%s userId=%s", tweetID, userID)
			continue
		}
		c.debugf("v3: tweet fetched locally tweetId=%s userId=%s", tweetID, userID)
		tweets = append(tweets, tweet)
	}
	return tweets, nil
}

// ---------------------------------------------------------------------------
// set_user_avatar
// ---------------------------------------------------------------------------

// entrySetUserAvatar records a new avatar on the account's root node.
func entrySetUserAvatar(c *ctx) (any, error) {
	userID := c.str("userid")
	avatar := c.str("avatar")

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	userSid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(userSid)

	stored, err := c.getObject(userSid, ownerDataKey)
	if err != nil {
		return c.wrapErr(err), nil
	}
	nodeID := c.nodeID()
	user := userObj(stored)
	if stored == nil || !user.hasValidHost() {
		c.errorf("missing host for user %s", jsonStringify(map[string]any{
			"userId": userID, "nodeId": nodeID,
		}))
		return c.wrapErr(fmt.Errorf("User not found or missing host")), nil
	}

	user["avatar"] = avatar
	mid := user.mid()
	if err := c.setValue(userSid, ownerDataKey, map[string]any(user)); err != nil {
		c.errorf("Failed to save user %s: %v", userID, err)
		return c.wrapErr(err), nil
	}
	if err := c.backupDelRef(userSid, mid, ""); err != nil {
		c.errorf("Failed to save/publish user %s: %v", userID, err)
		return c.wrapErr(err), nil
	}
	if err := c.mimeiPublish(userSid, mid); err != nil {
		c.warnf("publish %s failed: %v", mid, err)
	}
	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  mid,
		reqMID:    mid,
	}); err != nil {
		c.warnf("node_update_score failed: %v", err)
	}
	return c.wrapNotNull(avatar, "Avatar update failed"), nil
}

// ---------------------------------------------------------------------------
// verify_agent_token
// ---------------------------------------------------------------------------

// entryVerifyAgentToken checks an agent's signed request on behalf of another
// entry, and is also callable directly so a client can test its signing before
// relying on it.
func entryVerifyAgentToken(c *ctx) (any, error) {
	if c.appID() == "" {
		return agentAuthInvalid("Missing mandatory parameter: aid").toMap(), nil
	}
	auth, err := parseAgentAuth(c.str("agentAuth"))
	if err != nil {
		return agentAuthInvalid(err.Error()).toMap(), nil
	}
	if auth == nil {
		return agentAuthInvalid("Missing required agentAuth fields").toMap(), nil
	}
	requestData := map[string]any{}
	if raw := c.str("requestData"); raw != "" {
		if parsed, err := jsonParseObject(raw); err == nil {
			requestData = parsed
		}
	}
	return c.verifyAgentAuth(auth, requestData).toMap(), nil
}

// firstNonEmpty returns the first non-empty argument.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
