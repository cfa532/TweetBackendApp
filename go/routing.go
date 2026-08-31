// routing.go — checks a write entry makes before touching an account.
//
// Every account has one root node, named by user.hostIds[0], and that is where
// writes to the account and to anything it owns must happen. Choosing that node
// is the client's job: it knows which node owns the account and calls it
// directly. The backend does not bounce a misdirected request onwards — it
// refuses it, because writing here instead would produce a second copy of the
// account that replication has no way to reconcile with the root's.
//
// Alongside that, the existence check the entries always did. An account this
// node has never seen, or one with no host recorded, still fails the request
// rather than being written blindly.
package lapp

import "fmt"

// knownUser loads an account, rejecting one this node cannot resolve.
//
// The error text is unchanged from when this also decided routing, because
// clients match on it.
func (c *ctx) knownUser(userID string) (userObj, error) {
	user, err := c.loadUser(userID)
	if err != nil {
		c.errorf("getUser failed for mid=%s: %v", userID, err)
		return nil, err
	}
	if user == nil || !user.hasValidHost() {
		c.errorf("missing host for user %s", jsonStringify(map[string]any{
			"userId": userID, "nodeId": c.nodeID(),
		}))
		return nil, fmt.Errorf("User not found or missing host")
	}
	return user, nil
}

// requireKnownUser rejects a request naming an account this node cannot
// resolve. Reads use this; a write wants requireRootNode below.
func (c *ctx) requireKnownUser(userID string) error {
	_, err := c.knownUser(userID)
	return err
}

// requireRootNode rejects a write that has arrived at the wrong node.
//
// The account's root node owns every write to it, so a request that reaches any
// other node is a caller addressing the wrong one. Performing it would write a
// copy that the root never learns about and that the next synchronisation from
// the root overwrites, losing the write silently. Refusing says so at once.
func (c *ctx) requireRootNode(userID string) error {
	user, err := c.knownUser(userID)
	if err != nil {
		return err
	}
	return c.requireRootNodeFor(user, userID)
}

// requireRootNodeFor is requireRootNode for a caller that holds the account
// already, so the check costs no second read.
func (c *ctx) requireRootNodeFor(user userObj, userID string) error {
	nodeID := c.nodeID()
	if user.hostID() == nodeID {
		return nil
	}
	c.errorf("write aimed at the wrong node %s", jsonStringify(map[string]any{
		"userId": userID, "rootNode": user.hostID(), "nodeId": nodeID,
	}))
	return fmt.Errorf("Node %s is not the root node for user %s", nodeID, userID)
}

// present reports whether a request parameter was supplied at all, including as
// an empty string. Entries that treat "field omitted" and "field cleared" as
// different instructions need this rather than a non-empty check.
func (c *ctx) present(key string) bool {
	_, ok := c.req[key]
	return ok
}

// isHomeNode reports whether this node is the user's root, as seen through
// get_user_core_data: that entry reports hostIds as [root, this node], so the
// two being equal means this node is the root.
//
// List entries use this to decide whether they may prune stale entries. A
// failure to determine it is not fatal — the caller simply skips the cleanup and
// still returns its list.
func (c *ctx) isHomeNode(userID string) bool {
	owner, err := c.callEntryMap("get_user_core_data", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
	})
	if err != nil {
		c.errorf("get_user_core_data failed for userId=%s: %v", userID, err)
		return false
	}
	hosts := userObj(owner).hostIDs()
	return len(hosts) > 1 && hosts[0] != "" && hosts[0] == hosts[1]
}

// openWriterFor opens a writable handle on a user's account, used by the list
// entries that prune stale members. It returns empty strings when a writable
// handle cannot be obtained, which the callers treat as "skip the cleanup".
func (c *ctx) openWriterFor(userID string) (authSid, mmsid string) {
	sid, err := c.authSid()
	if err != nil {
		c.errorf("failed to open write session for userId=%s: %v", userID, err)
		return "", ""
	}
	handle, err := c.api.MMOpen(sid, userID, verCur)
	if err != nil {
		c.errorf("failed to open write session for userId=%s: %v", userID, err)
		return "", ""
	}
	return sid, handle
}

// fetchTweetV2 reads a tweet through get_tweet and unwraps the v2 envelope,
// yielding nil when the tweet is not available on this node. The list entries
// all read tweets this way.
func (c *ctx) fetchTweetV2(tweetID, appUserID string) any {
	resp, err := c.callEntryMap("get_tweet", map[string]string{
		reqAppID:    c.appID(),
		reqAppVer:   verLast,
		reqVersion:  versionV2,
		"appuserid": appUserID,
		"tweetid":   tweetID,
	})
	if err != nil || resp == nil || !mapBool(resp, "success") {
		return nil
	}
	return resp["data"]
}
