// feed_entries.go — timeline refresh and relationship cleanup.
//
// A user's feed is a sorted set on their own account, filled by walking the
// people they follow and copying across any tweet newer than the highest score
// already there. That walk must happen on the account's own node, because it
// writes to the account.
package lapp

import (
	"fmt"

	"Leither/lapi"
)

// A followed account that cannot be read is recorded rather than dropped
// immediately: a node can be offline for a while and come back. Only a streak
// that is both long and old enough is treated as permanent.
const (
	failedAccessRemovalAttempts = 14
	failedAccessRemovalAgeMs    = int64(7 * 24 * 60 * 60 * 1000)
)

// feedScanLimit bounds how many new tweets one refresh collects per followed
// user.
const feedScanLimit = 1000

// ---------------------------------------------------------------------------
// update_following_tweets
// ---------------------------------------------------------------------------

// entryUpdateFollowingTweets brings a user's feed up to date and returns
// whatever it added.
//
// hostid must name the user's own node, which owns both the following list and
// the feed, and this must be that node. The request is still checked against
// the account's recorded host so a call aimed at the wrong node is refused
// rather than half-applied to a replica.
func entryUpdateFollowingTweets(c *ctx) (any, error) {
	userID := c.str("appuserid")
	hostID := c.str("hostid")

	authSid, err := c.authSid()
	if err != nil {
		return respErrField(c, err), nil
	}

	// A bookkeeping change can be made before a later step fails. The tracker
	// keeps that partial change so a failure does not also discard it. It is
	// committed inside refreshFeedLocally, while its handle is still open.
	tracker := &followingAccessTracker{c: c, userID: userID}

	readSid, err := c.api.MMOpen(authSid, userID, verLast)
	if err != nil {
		return respErrField(c, err), nil
	}
	stored, err := c.getObject(readSid, ownerDataKey)
	if err != nil {
		c.closeMimei(readSid)
		return respErrField(c, err), nil
	}
	authoritativeHost := userObj(stored).hostID()
	if authoritativeHost == "" {
		c.closeMimei(readSid)
		return respErrField(c, fmt.Errorf("Cannot verify authoritative host for user %s", userID)), nil
	}
	if hostID != authoritativeHost {
		c.closeMimei(readSid)
		return respErrField(c, fmt.Errorf("Requested host %s is not authoritative for user %s", hostID, userID)), nil
	}

	// The highest score already in the feed is the watermark: anything above it
	// is new. Reading it before any synchronisation is what makes the result
	// "what this refresh added".
	last, err := c.zrevrange(readSid, userFollowingsTweets, 0, 0)
	c.closeMimei(readSid)
	if err != nil {
		return respErrField(c, err), nil
	}
	lastScore := int64(0)
	if len(last) > 0 {
		lastScore = last[0].Score + 1
	}

	return c.refreshFeedLocally(authSid, userID, lastScore, tracker)
}

// refreshFeedLocally walks the user's followings and collects their new tweets.
func (c *ctx) refreshFeedLocally(authSid, userID string, lastScore int64, tracker *followingAccessTracker) (any, error) {
	mmsid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return respErrField(c, err), nil
	}
	defer c.closeMimei(mmsid)
	tracker.sid = mmsid
	// Registered after the close so it runs before it: committing partial
	// bookkeeping needs the handle still open. Deferred calls run in reverse
	// order of registration.
	defer tracker.persistOnFailure()

	followings, err := c.hkeys(mmsid, userFollowingsList)
	if err != nil {
		return respErrField(c, err), nil
	}
	c.debugf("root, followings=%s", jsonStringify(strSlice(followings)))

	tweets := []any{}
	for _, uid := range followings {
		collected, err := c.collectFollowingTweets(uid, userID, lastScore, mmsid, tracker)
		if err != nil {
			// Only a failure to record access state stops the walk: it means
			// the bookkeeping is unreliable, and continuing would compound it.
			return respErrField(c, err), nil
		}
		tweets = append(tweets, collected...)
	}
	c.debugf("root new tweets %s", jsonStringify(tweets))

	if len(tweets) > 0 || tracker.changed {
		if err := c.backupDelRef(mmsid, userID, ""); err != nil {
			return respErrField(c, err), nil
		}
		if err := c.mimeiPublish(mmsid, userID); err != nil {
			c.warnf("publish %s failed: %v", userID, err)
		}
		tracker.changed = false
	}

	return c.wrapPassthrough(map[string]any{
		"success":        true,
		"tweets":         tweets,
		"originalTweets": []any{},
	}), nil
}

// collectFollowingTweets adds one followed user's new tweets to the feed.
//
// Reading the account is what decides whether the user is reachable; a failure
// after that point is transient and does not count against them.
func (c *ctx) collectFollowingTweets(uid, userID string, lastScore int64, userSid string, tracker *followingAccessTracker) ([]any, error) {
	followed, err := c.loadUser(uid)
	if err != nil || followed == nil {
		c.errorf("updateUser: user not found, uid=%s, nodeId=%s", uid, c.nodeID())
		return nil, tracker.recordFailure(uid)
	}
	// One good read clears the whole streak, even if the steps below fail.
	if err := tracker.clearFailure(uid); err != nil {
		return nil, err
	}

	// Pull the followed user's latest state before reading their tweet list,
	// so the list reflects what they have actually published.
	if sourceHost := followed.hostID(); sourceHost != "" {
		if _, err := c.callEntry("node_update_mid_by_score", map[string]string{
			reqAppID:  c.appID(),
			reqAppVer: verLast,
			"hostid":  sourceHost,
			"userid":  uid,
			reqMID:    uid,
		}); err != nil {
			c.errorf("Failed to update user score: %v, uid=%s, hostId=%s", err, uid, sourceHost)
		}
	}

	// Reopened after the synchronisation above so the freshly pulled tweet list
	// is the one that gets read.
	var newTweets []lapi.ScorePair
	err = c.readMimei("", uid, func(mmsid string) error {
		got, err := c.zrangebyscore(mmsid, userTweetList, lastScore, nowMillis(), 0, feedScanLimit)
		if err != nil {
			return err
		}
		newTweets = got
		return nil
	})
	if err != nil {
		c.errorf("updateUser error: %v, uid=%s", err, uid)
		return nil, nil
	}
	c.debugf("updateUser: count=%d, lastScore=%d, uid=%s", len(newTweets), lastScore, uid)

	if len(newTweets) > 0 {
		// The tweets keep their own scores so the feed stays in post order.
		if _, err := c.api.Zadd(userSid, userFollowingsTweets, newTweets...); err != nil {
			c.errorf("updateUser error: %v, uid=%s", err, uid)
			return nil, nil
		}
	}

	tweets := []any{}
	for _, pair := range newTweets {
		if tweet := c.fetchTweetV2(pair.Member, userID); tweet != nil {
			tweets = append(tweets, tweet)
		}
	}
	return tweets, nil
}

// ---------------------------------------------------------------------------
// Access-failure bookkeeping
// ---------------------------------------------------------------------------

// followingAccessTracker records which followed accounts could not be read,
// and drops one once the streak proves it is gone for good rather than briefly
// offline.
type followingAccessTracker struct {
	c      *ctx
	userID string
	// sid is the writable handle on the calling user's account.
	sid string
	// changed is set when the record was modified but not yet persisted.
	changed bool
}

// recordFailure notes one failed read, removing the following once both the
// attempt count and the age threshold are met.
func (t *followingAccessTracker) recordFailure(uid string) error {
	if t.sid == "" {
		return nil
	}
	now := nowMillis()
	previous, err := t.c.hget(t.sid, userFailedFollowingAccesses, uid)
	if err != nil {
		t.c.errorf("failed to record following access failure: %v, uid=%s, userId=%s", err, uid, t.userID)
		return fmt.Errorf("Failed to record following access failure: %v", err)
	}

	firstFailedAt, attempts := now, int64(1)
	if record, ok := toMap(previous); ok && validAccessFailure(record, now) {
		firstFailedAt = mapInt(record, "firstFailedAt", now)
		attempts = mapInt(record, "attempts", 0) + 1
	}

	if attempts >= failedAccessRemovalAttempts && now-firstFailedAt >= failedAccessRemovalAgeMs {
		// The failure record is cleared first. If removing the following then
		// fails, the leftover state is the conservative one: the following
		// stays and its grace period restarts on the next failure.
		if err := t.c.hdel(t.sid, userFailedFollowingAccesses, uid); err != nil {
			t.c.errorf("failed to record following access failure: %v, uid=%s, userId=%s", err, uid, t.userID)
			return fmt.Errorf("Failed to record following access failure: %v", err)
		}
		t.changed = true
		if err := t.c.hdel(t.sid, userFollowingsList, uid); err != nil {
			t.c.errorf("failed to record following access failure: %v, uid=%s, userId=%s", err, uid, t.userID)
			return fmt.Errorf("Failed to record following access failure: %v", err)
		}
		t.c.warnf("removed inaccessible following after %d attempts, uid=%s, firstFailedAt=%d, userId=%s",
			attempts, uid, firstFailedAt, t.userID)
		return nil
	}

	if err := t.c.hset(t.sid, userFailedFollowingAccesses, uid, map[string]any{
		"firstFailedAt": firstFailedAt,
		"lastFailedAt":  now,
		"attempts":      attempts,
	}); err != nil {
		t.c.errorf("failed to record following access failure: %v, uid=%s, userId=%s", err, uid, t.userID)
		return fmt.Errorf("Failed to record following access failure: %v", err)
	}
	t.changed = true
	return nil
}

// clearFailure erases any streak for a user that has just been read
// successfully.
func (t *followingAccessTracker) clearFailure(uid string) error {
	if t.sid == "" {
		return nil
	}
	previous, err := t.c.hget(t.sid, userFailedFollowingAccesses, uid)
	if err != nil {
		t.c.errorf("failed to clear following access failures: %v, uid=%s, userId=%s", err, uid, t.userID)
		return fmt.Errorf("Failed to clear following access failures: %v", err)
	}
	if previous == nil {
		return nil
	}
	if err := t.c.hdel(t.sid, userFailedFollowingAccesses, uid); err != nil {
		t.c.errorf("failed to clear following access failures: %v, uid=%s, userId=%s", err, uid, t.userID)
		return fmt.Errorf("Failed to clear following access failures: %v", err)
	}
	t.changed = true
	return nil
}

// persistOnFailure saves bookkeeping that was changed but never committed,
// which happens when a later step fails and the entry returns early.
func (t *followingAccessTracker) persistOnFailure() {
	if !t.changed || t.sid == "" {
		return
	}
	if err := t.c.backupDelRef(t.sid, t.userID, ""); err != nil {
		t.c.errorf("failed to persist partial following access state: %v, userId=%s", err, t.userID)
		return
	}
	if err := t.c.mimeiPublish(t.sid, t.userID); err != nil {
		t.c.errorf("failed to persist partial following access state: %v, userId=%s", err, t.userID)
	}
}

// validAccessFailure checks a stored streak before it is extended. A record
// with impossible timestamps or a negative count cannot be trusted to represent
// a real streak, and continuing from it could remove a following early.
func validAccessFailure(record map[string]any, now int64) bool {
	first, firstOK := toInt64(record["firstFailedAt"])
	last, lastOK := toInt64(record["lastFailedAt"])
	attempts, attemptsOK := toInt64(record["attempts"])
	return firstOK && lastOK && attemptsOK &&
		first > 0 && first <= now &&
		last >= first && last <= now &&
		attempts >= 1
}

// ---------------------------------------------------------------------------
// remove_blacklisted_relationship
// ---------------------------------------------------------------------------

// entryRemoveBlacklistedRelationship drops a follower or following that a
// client has found permanently unreachable.
//
// This deletes a relationship the user chose, so it is guarded rather than
// trusted: the caller must show a long enough failure streak, the entry must be
// running on the profile owner's own node, and the relationship must predate
// the streak. That last check is what stops a re-follow during the streak from
// being undone. It is idempotent, so a client may retry.
func entryRemoveBlacklistedRelationship(c *ctx) (any, error) {
	ownerID := c.str("userid")
	otherID := c.str("otherid")
	relationship := c.str("relationship")
	ownerHostHint := c.str("userid_hostid")
	failureStartedAt := c.intParam("failurestartedat", 0)
	failureCount := c.intParam("failurecount", 0)

	listKey := ""
	switch relationship {
	case "followers":
		listKey = userFollowersList
	case "followings":
		listKey = userFollowingsList
	}

	if ownerID == "" || otherID == "" || ownerID == otherID {
		return c.wrapErr(fmt.Errorf("Invalid relationship cleanup request")), nil
	}
	if listKey == "" {
		return c.wrapErr(fmt.Errorf("Relationship must be followers or followings")), nil
	}
	if failureStartedAt <= 0 {
		return c.wrapErr(fmt.Errorf("Missing failure streak start time")), nil
	}
	if failureCount < failedAccessRemovalAttempts || nowMillis()-failureStartedAt < failedAccessRemovalAgeMs {
		return c.wrapErr(fmt.Errorf("Permanent blacklist threshold not reached")), nil
	}

	nodeID := c.nodeID()
	owner, err := c.loadUser(ownerID)
	if err != nil {
		c.warnf("owner unavailable locally, userid=%s, nodeId=%s: %v", ownerID, nodeID, err)
	}
	ownerHostID := owner.hostID()
	if ownerHostID == "" {
		ownerHostID = ownerHostHint
	}
	if ownerHostID == "" {
		return c.wrapErr(fmt.Errorf("Profile owner host not found")), nil
	}

	// Re-read here: only this node's copy is authoritative for the lists.
	owner, err = c.loadUser(ownerID)
	if err != nil {
		return c.wrapErr(err), nil
	}
	if owner == nil || owner.hostID() != nodeID {
		return c.wrapErr(fmt.Errorf("Current node is not the profile owner's authoritative host")), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	readSid, err := c.api.MMOpen(authSid, ownerID, verLast)
	if err != nil {
		return c.wrapErr(err), nil
	}
	value, err := c.hget(readSid, listKey, otherID)
	c.closeMimei(readSid)
	if err != nil {
		return c.wrapErr(err), nil
	}
	if value == nil {
		return c.wrapPassthrough(map[string]any{"removed": false, "reason": "not_found"}), nil
	}

	addedAt, ok := toInt64(value)
	if !ok || addedAt <= 0 {
		c.warnf("retained relationship with invalid timestamp, userid=%s, otherid=%s, relationship=%s",
			ownerID, otherID, relationship)
		return c.wrapPassthrough(map[string]any{"removed": false, "reason": "invalid_relationship_timestamp"}), nil
	}
	if addedAt > failureStartedAt {
		// Re-established after the streak began, so the streak does not describe
		// this relationship.
		c.debugf("retained newer relationship, userid=%s, otherid=%s, relationship=%s, addedAt=%d, failureStartedAt=%d",
			ownerID, otherID, relationship, addedAt, failureStartedAt)
		return c.wrapPassthrough(map[string]any{"removed": false, "reason": "relationship_is_newer"}), nil
	}

	writeSid, err := c.api.MMOpen(authSid, ownerID, verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(writeSid)

	if err := c.hdel(writeSid, listKey, otherID); err != nil {
		return c.wrapErr(err), nil
	}
	if relationship == "followings" {
		if err := c.hdel(writeSid, userFailedFollowingAccesses, otherID); err != nil {
			return c.wrapErr(err), nil
		}
	}
	if err := c.backupDelRef(writeSid, ownerID, ""); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.mimeiPublish(authSid, ownerID); err != nil {
		c.warnf("publish %s failed: %v", ownerID, err)
	}

	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  ownerID,
		reqMID:    ownerID,
	}); err != nil {
		c.errorf("score update failed, userid=%s: %v", ownerID, err)
	}

	c.warnf("removed permanently inaccessible %s, userid=%s, otherid=%s", relationship, ownerID, otherID)
	return c.wrapPassthrough(map[string]any{"removed": true}), nil
}
