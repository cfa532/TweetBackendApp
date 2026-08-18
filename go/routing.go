// routing.go — checks a write entry makes before touching an account.
//
// Every account has one root node, named by user.hostIds[0], and that is where
// writes to the account and to anything it owns must happen. Choosing that node
// is the client's job: it knows which node owns the account and calls it
// directly. The backend no longer inspects the host and bounces a misdirected
// request onwards.
//
// What remains is the existence check the entries always did alongside that
// routing. An account this node has never seen, or one with no host recorded,
// still fails the request rather than being written blindly.
package lapp

import "fmt"

// requireKnownUser rejects a write naming an account this node cannot resolve.
//
// The error text is unchanged from when this also decided routing, because
// clients match on it.
func (c *ctx) requireKnownUser(userID string) error {
	user, err := c.loadUser(userID)
	if err != nil {
		c.errorf("getUser failed for mid=%s: %v", userID, err)
		return err
	}
	if user == nil || !user.hasValidHost() {
		c.errorf("missing host for user %s", jsonStringify(map[string]any{
			"userId": userID, "nodeId": c.nodeID(),
		}))
		return fmt.Errorf("User not found or missing host")
	}
	return nil
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
