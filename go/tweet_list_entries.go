// tweet_list_entries.go — tweet edits, timelines and pinning.
//
// # The pagination contract
//
// Timeline entries return exactly one slot per sorted-set entry they scanned,
// with null in the slot when the tweet is missing or hidden. Clients decide
// whether more pages exist by comparing the returned length against the
// requested page size, and compute each page's offset as pageNumber * pageSize
// with no knowledge of what earlier requests did.
//
// That only holds if the response describes precisely the range that was asked
// for. An earlier implementation instead kept scanning until it had a full page
// of usable tweets, dropping the rest. Combined with the stale-entry cleanup
// below, which permanently shifts every later item's rank down, a client's
// offset could drift past live content and report the end of a timeline while
// tweets remained. One bounded read plus null placeholders removes the
// dependency on rank stability between requests.
package lapp

import (
	"fmt"
	"strings"

	"Leither/lapi"
)

// ---------------------------------------------------------------------------
// update_tweet
// ---------------------------------------------------------------------------

// entryUpdateTweet edits a tweet's content and, optionally, its attachments and
// flags. Only the author may edit, and only the fields supplied are changed.
func entryUpdateTweet(c *ctx) (any, error) {
	appUserID := c.str("appuserid")
	tweetID := c.str("tweetid")
	content := c.str("content")

	// Only the author edits, and the tweet lives on their root node; the reply
	// shape for a rejection is part of the client contract.
	if err := c.requireRootNode(appUserID); err != nil {
		return respErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	tweetSid, err := c.api.MMOpen(authSid, tweetID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)), nil
	}
	defer c.closeMimei(tweetSid)

	stored, err := c.getObject(tweetSid, tweetContentKey)
	if err != nil {
		return respErr(err), nil
	}
	if stored == nil {
		return respErr(fmt.Errorf("Tweet not found")), nil
	}
	tweet := tweetObj(stored)
	if tweet.authorID() != appUserID {
		return respErr(fmt.Errorf("Only the tweet author can update content")), nil
	}

	// Attachments are reconciled only when supplied, so a client that only
	// edits text does not clear the media.
	if c.present("attachments") {
		next, err := parseAttachments(c.str("attachments"))
		if err != nil {
			return respErr(err), nil
		}
		if err := c.reconcileAttachments(tweetSid, tweetID, tweet, next); err != nil {
			return respErr(err), nil
		}
		tweet["attachments"] = next
	}
	if c.present("downloadable") {
		value, err := parseBooleanOption("downloadable", c.str("downloadable"))
		if err != nil {
			return respErr(err), nil
		}
		tweet["downloadable"] = value
	}
	if c.present("isPrivate") {
		value, err := parseBooleanOption("isPrivate", c.str("isPrivate"))
		if err != nil {
			return respErr(err), nil
		}
		tweet["isPrivate"] = value
	}
	tweet["content"] = content

	if err := c.setValue(tweetSid, tweetContentKey, map[string]any(tweet)); err != nil {
		return respErr(err), nil
	}
	if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.warnf("publish %s failed: %v", tweetID, err)
	}
	c.debugf("local tweet=%s", jsonStringify(map[string]any(tweet)))
	return c.wrapPassthrough(map[string]any{"success": true, "mid": tweetID}), nil
}

// parseBooleanOption reads a flag that must be stated explicitly. Request
// parameters are strings, so an unrecognised value is rejected rather than
// being read as false.
func parseBooleanOption(name, value string) (bool, error) {
	switch value {
	case "true":
		return true, nil
	case "false":
		return false, nil
	}
	return false, fmt.Errorf("%s must be true or false", name)
}

// parseAttachments decodes a replacement attachment list. Every entry must name
// a Mimei, since that id is what the tweet's reference points at.
func parseAttachments(raw string) ([]any, error) {
	items, err := jsonParseArray(raw)
	if err != nil {
		return nil, fmt.Errorf("Attachments must be an array")
	}
	for _, item := range items {
		attachment, ok := toMap(item)
		if !ok || mapStr(attachment, "mid") == "" {
			return nil, fmt.Errorf("Each attachment must have a valid mid")
		}
		if ts, ok := toFloat(attachment["timestamp"]); ok {
			attachment["timestamp"] = ts
		}
	}
	return items, nil
}

// reconcileAttachments moves the tweet's references from the old attachment set
// to the new one, so removed media stops being referenced and becomes
// collectable while added media is kept alive.
func (c *ctx) reconcileAttachments(tweetSid, tweetID string, tweet tweetObj, next []any) error {
	previous := map[string]bool{}
	for _, attachment := range tweet.attachments() {
		if mid := mapStr(attachment, "mid"); mid != "" {
			previous[mid] = true
		}
	}
	wanted := map[string]bool{}
	for _, item := range next {
		if attachment, ok := toMap(item); ok {
			if mid := mapStr(attachment, "mid"); mid != "" {
				wanted[mid] = true
			}
		}
	}
	for mid := range previous {
		if !wanted[mid] {
			if err := c.delRef(tweetSid, tweetID, mid); err != nil {
				return err
			}
		}
	}
	for mid := range wanted {
		if !previous[mid] {
			if err := c.addRef(tweetSid, tweetID, mid); err != nil {
				return err
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// toggle_tweet_privacy
// ---------------------------------------------------------------------------

// entryToggleTweetPrivacy flips a tweet between public and private. Only the
// author may do so.
func entryToggleTweetPrivacy(c *ctx) (any, error) {
	appUserID := c.str("appuserid")
	tweetID := c.str("tweetid")

	// Only the author flips this, and the tweet lives on their root node.
	if err := c.requireRootNode(appUserID); err != nil {
		return c.wrapErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	tweetSid, err := c.api.MMOpen(authSid, tweetID, verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(tweetSid)

	stored, err := c.getObject(tweetSid, tweetContentKey)
	if err != nil {
		return c.wrapErr(err), nil
	}
	if stored == nil {
		return c.wrapErr(fmt.Errorf("Tweet not found")), nil
	}
	tweet := tweetObj(stored)
	if tweet.authorID() != appUserID {
		return c.wrapErr(fmt.Errorf("Only the tweet author can update privacy settings")), nil
	}

	isPrivate := !tweet.isPrivate()
	tweet["isPrivate"] = isPrivate

	if err := c.setValue(tweetSid, tweetContentKey, map[string]any(tweet)); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.backupDelRef(tweetSid, tweetID, ""); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.warnf("publish %s failed: %v", tweetID, err)
	}
	c.debugf("local tweet=%s", jsonStringify(map[string]any(tweet)))
	return c.wrapPrivacy(isPrivate), nil
}

// wrapPrivacy reports the new privacy flag, naming it for v2 callers.
func (c *ctx) wrapPrivacy(result any) any {
	if c.isV2() {
		if b, ok := result.(bool); ok {
			return respOK(map[string]any{"isPrivate": b})
		}
		return respOK(result)
	}
	return result
}

// ---------------------------------------------------------------------------
// get_tweet_id_list
// ---------------------------------------------------------------------------

// entryGetTweetIDList returns a user's public tweet ids, newest first, with
// their scores. Private tweets are excluded: this list is used to publish a
// user's history to others.
func entryGetTweetIDList(c *ctx) (any, error) {
	userID := c.str("userid")

	var public []lapi.ScorePair
	err := c.readMimei("", userID, func(mmsid string) error {
		all, err := c.zrevrange(mmsid, userTweetList, 0, -1)
		if err != nil {
			return err
		}
		c.debugf("user=%s count=%d", userID, len(all))
		for _, pair := range all {
			if pair.Member == "" {
				continue
			}
			tweet, err := c.loadTweet(pair.Member)
			if err != nil {
				c.errorf("stage=open tweet, tweetid=%s, message=%v, request=%s",
					pair.Member, err, c.requestJSON())
				continue
			}
			if tweet != nil && !tweet.isPrivate() {
				public = append(public, pair)
			}
		}
		return nil
	})
	if err != nil {
		return c.wrapErrList(err), nil
	}
	if public == nil {
		public = []lapi.ScorePair{}
	}
	c.debugf("user=%s publicTweetCount=%d", userID, len(public))
	return c.wrap(public), nil
}

// ---------------------------------------------------------------------------
// get_tweets_by_user
// ---------------------------------------------------------------------------

// entryGetTweetsByUser returns one page of a user's own tweets.
//
// On the user's root node this also prunes ids whose tweet no longer exists.
// The pruning happens after the page is built, because it renumbers the sorted
// set and the response must describe the range as it was read.
func entryGetTweetsByUser(c *ctx) (any, error) {
	userID := c.str("userid")
	appUserID := c.str("appuserid")
	pageNum := c.intParam("pn", 0)
	pageSize := c.intParam("ps", 0)

	readSid, err := c.api.MMOpen("", userID, verLast)
	if err != nil {
		return respErrField(c, err), nil
	}
	defer c.closeMimei(readSid)

	// Pruning is only authoritative on the root node; doing it on a replica
	// would delete from a copy that synchronisation will overwrite anyway.
	isHome := c.isHomeNode(userID)
	var authSid, writeSid string
	if isHome {
		authSid, writeSid = c.openWriterFor(userID)
		if writeSid == "" {
			isHome = false
		} else {
			defer c.closeMimei(writeSid)
		}
	}

	offset := int(pageNum * pageSize)
	batch, err := c.zrevrange(readSid, userTweetList, offset, offset+int(pageSize)-1)
	if err != nil {
		return respErrField(c, err), nil
	}

	tweets := make([]any, 0, len(batch))
	originalTweets := []any{}
	validIDs := []any{}
	var stale []string

	for _, pair := range batch {
		tweetID := pair.Member
		if tweetID == "" {
			tweets = append(tweets, nil)
			continue
		}
		tweet, _ := toMap(c.fetchTweetV2(tweetID, appUserID))
		if tweet == nil {
			// Gone. Note it for pruning, but still occupy the slot so the page
			// length reflects what was scanned.
			if isHome {
				stale = append(stale, tweetID)
			}
			tweets = append(tweets, nil)
			continue
		}
		// A private tweet is hidden from everyone but its author. It is not
		// stale, so it keeps its slot and is not pruned.
		if mapBool(tweet, "isPrivate") && appUserID != mapStr(tweet, "authorId") {
			tweets = append(tweets, nil)
			continue
		}
		validIDs = append(validIDs, tweetID)
		if originalID := mapStr(tweet, "originalTweetId"); originalID != "" {
			if original := c.fetchTweetV2(originalID, appUserID); original != nil {
				originalTweets = append(originalTweets, original)
			}
		}
		tweets = append(tweets, tweet)
	}

	// Cleanup is best-effort: the page was assembled successfully and must be
	// returned even if pruning fails.
	if isHome && len(stale) > 0 {
		removed := 0
		for _, tweetID := range stale {
			c.warnf("removing stale tweetId=%s from user lists, userId=%s", tweetID, userID)
			if err := c.zrem(writeSid, userTweetList, tweetID); err != nil {
				c.errorf("failed to remove stale tweetIds for userId=%s: %v", userID, err)
				break
			}
			removed++
		}
		if removed > 0 {
			c.warnf("removed %d stale tweetId(s) from user lists, userId=%s, page=%d", removed, userID, pageNum)
			if err := c.backupDelRef(writeSid, userID, ""); err != nil {
				c.errorf("failed to persist/publish cleanup for userId=%s: %v", userID, err)
			} else if err := c.mimeiPublish(authSid, userID); err != nil {
				c.errorf("failed to persist/publish cleanup for userId=%s: %v", userID, err)
			}
		}
	}

	return c.wrapPassthrough(map[string]any{
		"success":        true,
		"tweets":         tweets,
		"originalTweets": originalTweets,
		"tidList":        validIDs,
	}), nil
}

// respErrField reports a timeline failure. Legacy callers received the message
// under "error" rather than "message".
func respErrField(c *ctx, err error) any {
	c.failf(err)
	if c.isV2() {
		return respErr(err)
	}
	return map[string]any{"success": false, "error": err.Error()}
}

// ---------------------------------------------------------------------------
// get_tweet_feed
// ---------------------------------------------------------------------------

// entryGetTweetFeed returns one page of the timeline assembled from the people
// a user follows.
//
// Missing tweets become null rather than triggering a network fetch: a feed
// read that blocks on DHT recovery would stall the whole page.
func entryGetTweetFeed(c *ctx) (any, error) {
	userID := c.str("userid")
	appUserID := c.str("appuserid")
	pageNum := c.intParam("pn", 0)
	pageSize := c.intParam("ps", 0)

	readSid, err := c.api.MMOpen("", userID, verLast)
	if err != nil {
		return respErrField(c, err), nil
	}
	defer c.closeMimei(readSid)

	offset := int(pageNum * pageSize)
	batch, err := c.zrevrange(readSid, userFollowingsTweets, offset, offset+int(pageSize)-1)
	if err != nil {
		return respErrField(c, err), nil
	}

	tweets := make([]any, 0, len(batch))
	originalTweets := []any{}
	for _, pair := range batch {
		tweetID := pair.Member
		if tweetID == "" {
			tweets = append(tweets, nil)
			continue
		}
		tweet, _ := toMap(c.fetchTweetV2(tweetID, appUserID))
		if tweet == nil || mapBool(tweet, "isPrivate") {
			tweets = append(tweets, nil)
			continue
		}
		if originalID := mapStr(tweet, "originalTweetId"); originalID != "" {
			if original := c.fetchTweetV2(originalID, appUserID); original != nil {
				originalTweets = append(originalTweets, original)
			}
		}
		tweets = append(tweets, tweet)
	}

	return c.wrapPassthrough(map[string]any{
		"success":        true,
		"tweets":         tweets,
		"originalTweets": originalTweets,
	}), nil
}

// ---------------------------------------------------------------------------
// get_pinned_tweets
// ---------------------------------------------------------------------------

// entryGetPinnedTweets returns a user's pinned tweets, each with the time it
// was pinned. On the user's root node, pins whose tweet no longer exists are
// removed.
func entryGetPinnedTweets(c *ctx) (any, error) {
	userID := c.str("userid")
	appUserID := c.str("appuserid")

	readSid, err := c.api.MMOpen("", userID, verLast)
	if err != nil {
		return c.wrapErrList(err), nil
	}
	defer c.closeMimei(readSid)

	isHome := c.isHomeNode(userID)
	var authSid, writeSid string
	if isHome {
		authSid, writeSid = c.openWriterFor(userID)
		if writeSid == "" {
			isHome = false
		} else {
			defer c.closeMimei(writeSid)
		}
	}

	tweetIDs, err := c.hkeys(readSid, userPinnedTweets)
	if err != nil {
		return c.wrapErrList(err), nil
	}

	result := []any{}
	var stale []string
	for _, tweetID := range tweetIDs {
		pinnedAt, err := c.hget(readSid, userPinnedTweets, tweetID)
		if err != nil {
			return c.wrapErrList(err), nil
		}
		if tweet := c.fetchTweetV2(tweetID, appUserID); tweet != nil {
			// The timestamp is when the tweet was pinned, not when it was written.
			result = append(result, map[string]any{
				"tweet":     tweet,
				"timestamp": toString(pinnedAt),
			})
			continue
		}
		if isHome {
			stale = append(stale, tweetID)
		}
	}

	if isHome && len(stale) > 0 {
		failed := false
		for _, tweetID := range stale {
			c.warnf("removing stale tweetId=%s from PINNED_TWEETS, userId=%s", tweetID, userID)
			if err := c.hdel(writeSid, userPinnedTweets, tweetID); err != nil {
				c.errorf("failed to remove stale tweetIds for userId=%s: %v", userID, err)
				failed = true
				break
			}
		}
		if !failed {
			if err := c.backupDelRef(writeSid, userID, ""); err != nil {
				c.errorf("failed to remove stale tweetIds for userId=%s: %v", userID, err)
			} else if err := c.mimeiPublish(authSid, userID); err != nil {
				c.errorf("failed to remove stale tweetIds for userId=%s: %v", userID, err)
			} else {
				c.warnf("removed %d stale tweetId(s) from PINNED_TWEETS, userId=%s", len(stale), userID)
			}
		}
	}

	return c.wrap(result), nil
}

// ---------------------------------------------------------------------------
// toggle_pinned_tweet
// ---------------------------------------------------------------------------

// entryTogglePinnedTweet pins or unpins a tweet on the user's profile and
// returns the resulting state.
func entryTogglePinnedTweet(c *ctx) (any, error) {
	tweetID := c.str("tweetid")
	appUserID := c.str("appuserid")

	// The pinned list is part of the profile, which lives on its root node.
	if err := c.requireRootNode(appUserID); err != nil {
		return c.wrapErrBool(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrBool(err), nil
	}
	userSid, err := c.api.MMOpen(authSid, appUserID, verCur)
	if err != nil {
		return c.wrapErrBool(err), nil
	}
	defer c.closeMimei(userSid)

	pinned, err := c.hhas(userSid, userPinnedTweets, tweetID)
	if err != nil {
		return c.wrapErrBool(err), nil
	}
	if pinned {
		if err := c.hdel(userSid, userPinnedTweets, tweetID); err != nil {
			return c.wrapErrBool(err), nil
		}
	} else {
		if err := c.hset(userSid, userPinnedTweets, tweetID, nowMillis()); err != nil {
			return c.wrapErrBool(err), nil
		}
	}

	if err := c.backupDelRef(authSid, appUserID, ""); err != nil {
		c.errorf("Failed to backup/publish user %s: %v", appUserID, err)
	} else if err := c.mimeiPublish(authSid, appUserID); err != nil {
		c.errorf("Failed to backup/publish user %s: %v", appUserID, err)
	}
	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  appUserID,
		reqMID:    appUserID,
	}); err != nil {
		c.errorf("Failed to update user score %s: %v", appUserID, err)
	}

	return c.wrapPinned(!pinned), nil
}

// wrapPinned reports the new pinned state, naming it for v2 callers.
func (c *ctx) wrapPinned(result any) any {
	if c.isV2() {
		if b, ok := result.(bool); ok {
			return respOK(map[string]any{"isPinned": b})
		}
		if m, ok := toMap(result); ok {
			if _, isEnvelope := m["success"]; isEnvelope {
				return m
			}
		}
		return respOK(result)
	}
	return result
}

// wrapErrBool reports a toggle failure. Legacy callers read the result as a
// boolean, so a failure is reported as false.
func (c *ctx) wrapErrBool(err error) any {
	c.failf(err)
	if c.isV2() {
		return respErr(err)
	}
	return false
}

// ---------------------------------------------------------------------------
// retweet_added / retweet_removed
// ---------------------------------------------------------------------------

// entryRetweetAdded records a retweet against the tweet that was retweeted.
func entryRetweetAdded(c *ctx) (any, error) {
	return c.updateRetweetList("retweet_added", true)
}

// entryRetweetRemoved removes a retweet record from the original tweet.
func entryRetweetRemoved(c *ctx) (any, error) {
	return c.updateRetweetList("retweet_removed", false)
}

// updateRetweetList adds or removes an entry in a tweet's retweet list.
//
// The list is keyed by retweet id rather than by user, because one user can
// retweet the same tweet more than once. The write happens on the original
// author's node, since the list lives inside their tweet.
func (c *ctx) updateRetweetList(entry string, add bool) (any, error) {
	retweetID := c.str("retweetid")
	tweetID := c.str("tweetid")
	appUserID := c.str("appuserid")
	authorID := c.str("authorid")

	// The list lives inside the author's tweet, so this must be their node.
	if err := c.requireRootNode(authorID); err != nil {
		return c.wrapErr(fmt.Errorf("Author not found or missing host")), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	tweetSid, err := c.api.MMOpen(authSid, tweetID, verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(tweetSid)

	if add {
		if err := c.hset(tweetSid, tweetRetweetList, retweetID, appUserID); err != nil {
			return c.wrapErr(err), nil
		}
	} else {
		if err := c.hdel(tweetSid, tweetRetweetList, retweetID); err != nil {
			return c.wrapErr(err), nil
		}
	}

	if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.warnf("publish %s failed: %v", tweetID, err)
	}

	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  authorID,
		reqMID:    tweetID,
	}); err != nil {
		c.warnf("node_update_score failed: %v", err)
	}

	return c.wrapRetweet(c.fetchTweetV2(tweetID, appUserID)), nil
}

// wrapRetweet wraps the refreshed tweet a retweet change produced.
func (c *ctx) wrapRetweet(result any) any {
	if c.isV2() {
		if result == nil {
			message := "Retweet operation failed"
			if strings.HasSuffix(c.entry, "_removed") {
				message = "Retweet removal failed"
			}
			return respFail(message)
		}
		if m, ok := toMap(result); ok {
			if _, isEnvelope := m["success"]; isEnvelope {
				return m
			}
		}
		return respOK(result)
	}
	return result
}
