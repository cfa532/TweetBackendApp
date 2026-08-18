// social_entries.go — following, followers and blocking.
//
// A follow is recorded twice, once on each side and each on its own node:
//
//	actor's account   list_of_followings_mid[target]  = when
//	target's account  list_of_followers_mid[actor]    = when
//
// toggle_following owns the actor's side and then calls toggle_follower on the
// target's node for the other half. Splitting it this way means each node only
// ever writes to accounts it owns.
//
// Following also seeds the actor's feed with the target's recent tweets, so a
// new follow shows something immediately rather than only future posts.
package lapp

import (
	"fmt"
	"sort"

	"Leither/lapi"
)

// followSeedCount is how many of a newly followed user's tweets are copied into
// the follower's feed, and how many are removed again on unfollow.
const followSeedCount = 20

// followersPageSize is the fixed page size of the follower and following lists.
const followersPageSize = 10

// ---------------------------------------------------------------------------
// toggle_following
// ---------------------------------------------------------------------------

// entryToggleFollowed is the older name for toggle_following, kept because
// released clients still call it.
func entryToggleFollowed(c *ctx) (any, error) {
	return c.callEntry("toggle_following", c.req)
}

// entryToggleFollowing follows or unfollows a user and returns the new state.
//
// The work happens on the actor's node, since it is the actor's account that
// gains or loses the relationship and the feed entries.
func entryToggleFollowing(c *ctx) (any, error) {
	// toggle_following predates the version parameter and defaults to v2.
	enveloped := c.version() == "" || c.isV2()
	fail := func(err error) any {
		c.errorf("%v, request=%s", err, c.requestJSON())
		if enveloped {
			return respErr(err)
		}
		return nil
	}
	ok := func(result any) any {
		if !enveloped {
			return result
		}
		if result == nil {
			return respFail("Operation failed")
		}
		if b, isBool := result.(bool); isBool {
			return respOK(map[string]any{"isFollowing": b})
		}
		if m, isMap := toMap(result); isMap {
			if _, isEnvelope := m["success"]; isEnvelope {
				// A delegated call already produced the envelope; nesting it
				// again would hide isFollowing from the client.
				return m
			}
		}
		return respOK(result)
	}

	userID := c.str("userid")
	followingID := c.str("followingid")
	followingHostID := c.str("followingid_hostid")

	if userID == followingID {
		return fail(fmt.Errorf("Cannot follow yourself")), nil
	}

	systemSid, err := c.nodeDataSid(verCur)
	if err != nil {
		return fail(err), nil
	}
	nodeID := c.nodeID()

	user, err := c.loadUser(userID)
	if err != nil {
		c.errorf("getUser failed for userId %s, will try hostId hint: %v", userID, err)
	}
	c.debugf("user=%s toggle %s on host=%s", jsonStringify(redactUser(user)), followingID, followingHostID)

	// The caller may supply the actor's host directly. That matters right after
	// registration, when the account exists but has not reached this node yet.
	userHostID := user.hostID()
	if userHostID == "" {
		userHostID = c.str("userid_hostid")
	}
	if userHostID == "" {
		c.errorf("missing host for user %s", jsonStringify(map[string]any{"userId": userID, "nodeId": nodeID}))
		return fail(fmt.Errorf("User host not found for user %s on %s", userID, nodeID)), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return fail(err), nil
	}

	// The target's account is needed to find the node holding its follower
	// list. If this node has no copy, pull one.
	followed, err := c.loadUser(followingID)
	if err != nil {
		c.errorf("getUser failed for mid=%s: %v", followingID, err)
	}
	c.debugf("followed user=%s with id=%s", jsonStringify(redactUser(followed)), followingID)
	if followed == nil {
		if err := c.mimeiSync(followingID, nil); err != nil {
			c.errorf("Failed to sync followed user %s from nid=%s: %v", followingID, followingHostID, err)
		} else if err := c.mimeiProvide(authSid, followingID); err != nil {
			c.errorf("Failed to sync followed user %s from nid=%s: %v", followingID, followingHostID, err)
		}
		followed, _ = c.loadUser(followingID)
		if followed == nil {
			c.errorf("cannot get followed user %s after sync (nid=%s)", followingID, followingHostID)
			return fail(fmt.Errorf("Cannot get followed user")), nil
		}
	}
	hostOfOther := followed.hostID()
	if hostOfOther == "" {
		c.errorf("missing host for followed user %s", jsonStringify(map[string]any{
			"userId": userID, "followingId": followingID,
		}))
		return fail(fmt.Errorf("Missing host for followed user")), nil
	}

	readSid, err := c.api.MMOpen(authSid, userID, verLast)
	if err != nil {
		return fail(err), nil
	}
	isFollowing, err := c.hhas(readSid, userFollowingsList, followingID)
	c.closeMimei(readSid)
	if err != nil {
		return fail(err), nil
	}

	if isFollowing {
		err = c.unfollow(authSid, systemSid, userID, followingID, hostOfOther, nodeID)
	} else {
		err = c.follow(authSid, systemSid, userID, followingID, hostOfOther, nodeID)
	}
	if err != nil {
		return fail(err), nil
	}

	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
		reqMID:    userID,
	}); err != nil {
		c.warnf("node_update_score failed: %v", err)
	}
	return ok(!isFollowing), nil
}

// follow records the relationship and seeds the actor's feed.
//
// The target's tweet list is fetched before anything is written, so a failure
// to reach the target's node leaves no half-made relationship behind.
func (c *ctx) follow(authSid, systemSid, userID, followingID, hostOfOther, nodeID string) error {
	c.debugf("%s following %s, host: %s, node: %s", userID, followingID, hostOfOther, nodeID)

	pairs, err := c.targetTweetList(systemSid, followingID, hostOfOther)
	if err != nil {
		return err
	}
	if len(pairs) > followSeedCount {
		pairs = pairs[:followSeedCount]
	}

	userSid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", userID, err)
	}
	defer c.closeMimei(userSid)

	if err := c.hset(userSid, userFollowingsList, followingID, nowMillis()); err != nil {
		return err
	}
	if len(pairs) > 0 {
		// The tweets keep their original scores, so they interleave with the
		// rest of the feed by post time rather than by follow time.
		if _, err := c.api.Zadd(userSid, userFollowingsTweets, pairs...); err != nil {
			return fmt.Errorf("Zadd(%s): %v", userFollowingsTweets, err)
		}
	}
	if err := c.backupDelRef(userSid, userID, ""); err != nil {
		return err
	}
	if err := c.mimeiPublish(authSid, userID); err != nil {
		c.warnf("publish %s failed: %v", userID, err)
	}
	c.debugf("relationship persisted actor=%s target=%s tweetCount=%d", userID, followingID, len(pairs))

	// Hold a local copy of the followed account so their profile renders
	// without a network round trip.
	if err := c.mimeiSync(followingID, nil); err != nil {
		c.errorf("Failed to sync followed user %s: %v", followingID, err)
	} else if err := c.mimeiProvide(authSid, followingID); err != nil {
		c.errorf("Failed to sync followed user %s: %v", followingID, err)
	}

	if err := c.updateFollowerSide(systemSid, followingID, userID, hostOfOther, true); err != nil {
		c.errorf("toggle_follower failed: %v, %s", err, c.requestJSON())
	}
	return nil
}

// unfollow removes the relationship and the seeded feed entries.
func (c *ctx) unfollow(authSid, systemSid, userID, followingID, hostOfOther, nodeID string) error {
	c.debugf("%s unfollowing %s. Host: %s, Node: %s", userID, followingID, hostOfOther, nodeID)

	// Only the same window that following seeded is removed; anything older was
	// never added by the follow.
	ids := []string{}
	if pairs, err := c.callEntry("get_tweet_id_list", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  followingID,
	}); err == nil {
		for _, id := range scorePairMembers(pairs) {
			if len(ids) >= followSeedCount {
				break
			}
			ids = append(ids, id)
		}
	}

	userSid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", userID, err)
	}
	defer c.closeMimei(userSid)

	if len(ids) > 0 {
		if err := c.zrem(userSid, userFollowingsTweets, ids...); err != nil {
			return err
		}
	}
	if err := c.hdel(userSid, userFollowingsList, followingID); err != nil {
		return err
	}
	if err := c.backupDelRef(userSid, userID, ""); err != nil {
		return err
	}
	if err := c.mimeiPublish(authSid, userID); err != nil {
		c.warnf("publish %s failed: %v", userID, err)
	}

	// The local copy of the unfollowed account is deliberately kept: another
	// followed user may reference it, and it may be the only copy here.
	if err := c.updateFollowerSide(systemSid, followingID, userID, hostOfOther, false); err != nil {
		c.errorf("toggle_follower: %v, %s", err, c.requestJSON())
	}
	return nil
}

// updateFollowerSide records the relationship on the target's own node.
func (c *ctx) updateFollowerSide(systemSid, targetID, actorID, targetHost string, isFollower bool) error {
	params := map[string]string{
		reqAppID:     c.appID(),
		reqAppVer:    verLast,
		reqSid:       systemSid,
		reqVersion:   c.version(),
		"userid":     targetID,
		"otherid":    actorID,
		"isfollower": boolParam(isFollower),
	}
	if targetHost == c.nodeID() {
		_, err := c.callEntry("toggle_follower", params)
		return err
	}
	_, err := c.callRemote(targetHost, "toggle_follower", params)
	return err
}

// targetTweetList reads a user's public tweet list, from their own node when
// that is not this one.
func (c *ctx) targetTweetList(systemSid, followingID, hostOfOther string) ([]lapi.ScorePair, error) {
	params := map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		reqSid:    systemSid,
		"userid":  followingID,
	}
	var result any
	var err error
	if hostOfOther == c.nodeID() {
		result, err = c.callEntry("get_tweet_id_list", params)
	} else {
		result, err = c.callRemote(hostOfOther, "get_tweet_id_list", params)
	}
	if err != nil {
		return nil, err
	}

	// The reply is a bare list from a legacy caller and an envelope from a v2
	// one; both shapes reach here depending on which node answered.
	if pairs, ok := asScorePairs(result); ok {
		return pairs, nil
	}
	if m, ok := toMap(result); ok {
		if mapBool(m, "success") {
			if pairs, ok := asScorePairs(m["data"]); ok {
				return pairs, nil
			}
		}
		if msg := mapStr(m, "message"); msg != "" {
			return nil, fmt.Errorf("%s", msg)
		}
	}
	return nil, fmt.Errorf("Invalid tweet list response")
}

// asScorePairs normalises a tweet-id list into score pairs. The list crosses
// the node boundary as generic values, so both the typed and decoded forms are
// accepted.
func asScorePairs(value any) ([]lapi.ScorePair, bool) {
	switch t := value.(type) {
	case []lapi.ScorePair:
		return t, true
	case []any:
		out := make([]lapi.ScorePair, 0, len(t))
		for _, item := range t {
			m, ok := toMap(item)
			if !ok {
				return nil, false
			}
			member := mapStr(m, "Member")
			if member == "" {
				continue
			}
			out = append(out, lapi.ScorePair{
				Score:  mapInt(m, "Score", 0),
				Member: member,
			})
		}
		return out, true
	}
	return nil, false
}

// scorePairMembers extracts member ids from a tweet-id list reply.
func scorePairMembers(value any) []string {
	pairs, ok := asScorePairs(value)
	if !ok {
		if m, isMap := toMap(value); isMap {
			pairs, ok = asScorePairs(m["data"])
		}
		if !ok {
			return nil
		}
	}
	out := make([]string, 0, len(pairs))
	for _, p := range pairs {
		if p.Member != "" {
			out = append(out, p.Member)
		}
	}
	return out
}

// redactUser prepares an account for a log line, without its credential.
func redactUser(user userObj) map[string]any {
	if user == nil {
		return nil
	}
	out := map[string]any{}
	for k, v := range user {
		out[k] = v
	}
	if _, ok := out["password"]; ok {
		out["password"] = "[redacted]"
	}
	return out
}

// ---------------------------------------------------------------------------
// toggle_follower
// ---------------------------------------------------------------------------

// entryToggleFollower records or removes a follower on the followed user's
// account. It is the second half of a follow and runs on that user's node.
func entryToggleFollower(c *ctx) (any, error) {
	userID := c.str("userid")
	otherID := c.str("otherid")
	isFollower := c.str("isfollower") == "true"

	if userID == otherID {
		return c.wrapErr(fmt.Errorf("Cannot follow yourself")), nil
	}

	// Resolved to reject a request for a user this node does not know. The
	// caller side still addresses this user's own node directly, because a
	// follow writes to two accounts that live on two different nodes.
	if err := c.requireKnownUser(userID); err != nil {
		return c.wrapErr(fmt.Errorf("User host not found")), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	userSid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(userSid)

	if isFollower {
		err = c.hset(userSid, userFollowersList, otherID, nowMillis())
	} else {
		err = c.hdel(userSid, userFollowersList, otherID)
	}
	if err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.backupDelRef(userSid, userID, ""); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.mimeiPublish(authSid, userID); err != nil {
		c.warnf("publish %s failed: %v", userID, err)
	}
	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
		reqMID:    userID,
	}); err != nil {
		c.errorf("Failed to update user score: %v, userId=%s", err, userID)
	}

	c.debugf("%s with follower %s, isFollower=%t", userID, otherID, isFollower)
	return c.wrapFollower(map[string]any{"success": true, "isFollower": isFollower}), nil
}

// wrapFollower wraps a follower-side reply for v2 callers.
func (c *ctx) wrapFollower(result any) any {
	if !c.isV2() {
		return result
	}
	if result == nil {
		return respFail("Operation failed")
	}
	if m, ok := toMap(result); ok {
		if _, isEnvelope := m["success"]; isEnvelope {
			return m
		}
	}
	return respOK(result)
}

// ---------------------------------------------------------------------------
// Follower and following listings
// ---------------------------------------------------------------------------

// entryGetFollowers returns one page of a user's followers as whole accounts.
func entryGetFollowers(c *ctx) (any, error) {
	return c.relationshipPage(userFollowersList)
}

// entryGetFollowings returns one page of the accounts a user follows.
func entryGetFollowings(c *ctx) (any, error) {
	return c.relationshipPage(userFollowingsList)
}

// relationshipPage returns one page of a relationship list, newest first, with
// each id resolved to a full account.
//
// An account this node does not hold is pulled once before being given up on,
// because a follower list full of gaps is not usable. This is the one listing
// that does reach across the network, and it is bounded to a page.
func (c *ctx) relationshipPage(listKey string) (any, error) {
	userID := c.str("userid")
	pageNumber := c.intParam("pn", 0)
	if pageNumber < 0 {
		pageNumber = 0
	}
	start := int(pageNumber) * followersPageSize

	var relationships []lapi.FVPair
	err := c.readMimei("", userID, func(mmsid string) error {
		got, err := c.api.Hgetall(mmsid, listKey)
		if err != nil {
			return fmt.Errorf("Hgetall(%s): %v", listKey, err)
		}
		relationships = got
		return nil
	})
	if err != nil {
		return c.wrapErrUsers(err), nil
	}

	sort.SliceStable(relationships, func(i, j int) bool {
		a, _ := toFloat(relationships[i].Value)
		b, _ := toFloat(relationships[j].Value)
		return a > b
	})
	end := start + followersPageSize
	if start > len(relationships) {
		start = len(relationships)
	}
	if end > len(relationships) {
		end = len(relationships)
	}

	users := []any{}
	for _, relationship := range relationships[start:end] {
		if user := c.recoverUser(relationship.Field); user != nil {
			users = append(users, user)
		}
	}
	return c.wrapPassthrough(map[string]any{"users": users, "success": true}), nil
}

// recoverUser reads an account, pulling it onto this node once if it is absent.
func (c *ctx) recoverUser(userID string) any {
	load := func() any {
		user, err := c.callEntry("get_user_core_data", map[string]string{
			reqAppID:  c.appID(),
			reqAppVer: verLast,
			"userid":  userID,
		})
		if err != nil {
			return nil
		}
		return user
	}
	if user := load(); user != nil {
		return user
	}

	if authSid, err := c.authSid(); err != nil {
		c.errorf("failed to sync/provide userId=%s: %v", userID, err)
	} else if err := c.mimeiSync(userID, nil); err != nil {
		c.errorf("failed to sync/provide userId=%s: %v", userID, err)
	} else if err := c.mimeiProvide(authSid, userID); err != nil {
		c.errorf("failed to sync/provide userId=%s: %v", userID, err)
	}

	user := load()
	if user == nil {
		c.errorf("userId=%s not found after sync/provide", userID)
	}
	return user
}

// wrapErrUsers reports a listing failure with an empty user list, so a client
// can render it without a nil check.
func (c *ctx) wrapErrUsers(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() {
		out := respErr(err)
		out["data"] = map[string]any{"users": []any{}}
		return out
	}
	return map[string]any{"users": []any{}, "success": false}
}

// entryGetFollowersSorted returns the raw follower list with its timestamps.
func entryGetFollowersSorted(c *ctx) (any, error) {
	return c.relationshipPairs(userFollowersList)
}

// entryGetFollowingsSorted returns the raw following list with its timestamps.
func entryGetFollowingsSorted(c *ctx) (any, error) {
	return c.relationshipPairs(userFollowingsList)
}

// relationshipPairs returns a relationship list as stored, without resolving
// the accounts. Clients use it to test membership cheaply.
func (c *ctx) relationshipPairs(listKey string) (any, error) {
	var pairs []lapi.FVPair
	err := c.readMimei("", c.str("userid"), func(mmsid string) error {
		got, err := c.api.Hgetall(mmsid, listKey)
		if err != nil {
			return fmt.Errorf("Hgetall(%s): %v", listKey, err)
		}
		pairs = got
		return nil
	})
	if err != nil {
		return c.wrapErrMap(err), nil
	}
	return c.wrap(pairs), nil
}

// wrapErrMap reports a listing failure whose empty value is an object.
func (c *ctx) wrapErrMap(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() {
		out := respErr(err)
		out["data"] = map[string]any{}
		return out
	}
	return map[string]any{}
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

// entryGetBlockedUsers returns the ids a user has blocked.
func entryGetBlockedUsers(c *ctx) (any, error) {
	var keys []string
	err := c.readMimei("", c.str("userid"), func(mmsid string) error {
		got, err := c.hkeys(mmsid, userBlockedUsers)
		if err != nil {
			return err
		}
		keys = got
		return nil
	})
	if err != nil {
		return c.wrapErrList(err), nil
	}
	return c.wrap(keys), nil
}

// entryBlockUser blocks a user and unfollows them in the same step, so a block
// takes effect on the feed immediately rather than after the next refresh.
func entryBlockUser(c *ctx) (any, error) {
	blockedUserID := c.str("blocked")
	userID := c.str("userid")

	// Resolved to reject a request for a user this node does not know.
	if err := c.requireKnownUser(userID); err != nil {
		return c.wrapErrSuccess(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrSuccess(err), nil
	}
	userSid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return c.wrapErrSuccess(err), nil
	}
	defer c.closeMimei(userSid)

	if err := c.hset(userSid, userBlockedUsers, blockedUserID, nowMillis()); err != nil {
		return c.wrapErrSuccess(err), nil
	}

	tweetIDs, err := c.callEntry("get_tweet_id_list", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  blockedUserID,
	})
	if err != nil {
		return c.wrapErrSuccess(err), nil
	}
	if ids := scorePairMembers(tweetIDs); len(ids) > 0 {
		if err := c.zrem(userSid, userFollowingsTweets, ids...); err != nil {
			return c.wrapErrSuccess(err), nil
		}
	}
	if err := c.hdel(userSid, userFollowingsList, blockedUserID); err != nil {
		return c.wrapErrSuccess(err), nil
	}
	if err := c.backupDelRef(userSid, userID, ""); err != nil {
		return c.wrapErrSuccess(err), nil
	}
	if err := c.mimeiPublish(userSid, userID); err != nil {
		c.warnf("publish %s failed: %v", userID, err)
	}
	return c.wrapPassthrough(map[string]any{"success": true}), nil
}

// wrapErrSuccess reports a failure whose legacy shape is a bare success flag.
func (c *ctx) wrapErrSuccess(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() {
		return respErr(err)
	}
	return map[string]any{"success": false}
}
