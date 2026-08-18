// tweet_entries.go — creating, reading and deleting tweets.
//
// A tweet is its own Mimei database, stored on its author's root node. Creating
// one also records a reference from the author's account to the tweet: that
// reference, not the tweet list, is what makes the tweet travel when the account
// is synchronised to another node.
package lapp

import "fmt"

// ---------------------------------------------------------------------------
// add_tweet
// ---------------------------------------------------------------------------

// entryAddTweet creates a tweet.
//
// The tweet is written here, on the node the client chose to call. The caller
// must be authorised either as a peer node holding a valid app code or as an
// agent with a signature over the request.
//
// The author's account is still loaded, both to reject a tweet whose author
// this node does not know and to supply the host used when attributing a
// front-end request in authorizePost.
func entryAddTweet(c *ctx) (any, error) {
	raw, err := c.obj("tweet")
	if err != nil {
		return respErr(err), nil
	}
	tweet := tweetObj(raw)

	agentAuth, err := parseAgentAuth(c.str("agentAuth"))
	if err != nil {
		return respErr(err), nil
	}

	user, err := c.loadUser(tweet.authorID())
	if err != nil {
		c.errorf("getUser failed for mid=%s: %v", tweet.authorID(), err)
		return respErr(err), nil
	}
	if user == nil || !user.hasValidHost() {
		c.errorf("missing host for user %s", jsonStringify(map[string]any{
			"authorId": tweet.authorID(), "nodeId": c.nodeID(),
		}))
		return respErr(fmt.Errorf("User host not found")), nil
	}
	return c.addTweetLocal(tweet, user, agentAuth)
}

// addTweetLocal creates the tweet on this node.
func (c *ctx) addTweetLocal(tweet tweetObj, user userObj, agentAuth map[string]any) (any, error) {
	if err := c.authorizePost(tweet, user, agentAuth); err != nil {
		return respErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	// "{{auto}}" asks Leither for a fresh id rather than deriving one from the
	// mark, so two tweets with identical text remain distinct objects.
	tweetID, err := c.api.MMCreate(authSid, c.appID(), appExt, "{{auto}}", mimeiTypeDatabase, rightUserObject)
	if err != nil {
		return respErr(fmt.Errorf("MMCreate(tweet): %v", err)), nil
	}

	tweetSid, err := c.api.MMOpen(authSid, tweetID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)), nil
	}
	defer c.closeMimei(tweetSid)

	tweet["mid"] = tweetID
	tweet["timestamp"] = nowMillis()
	if err := c.setValue(tweetSid, tweetContentKey, map[string]any(tweet)); err != nil {
		return respErr(err), nil
	}

	// Each attachment is its own Mimei; referencing it from the tweet keeps it
	// alive and carries it along when the tweet is synchronised.
	for _, attachment := range tweet.attachments() {
		if mid := mapStr(attachment, "mid"); mid != "" {
			if err := c.addRef(authSid, tweetID, mid); err != nil {
				c.warnf("attachment ref %s failed: %v", mid, err)
			}
		}
	}

	if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.warnf("publish %s failed: %v", tweetID, err)
	}

	authorID := tweet.authorID()
	userSid, err := c.api.MMOpen(authSid, authorID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", authorID, err)), nil
	}
	defer c.closeMimei(userSid)

	// The same score puts the tweet in the author's own list and in the feed
	// their followers read.
	score := nowMillis()
	if err := c.zadd(userSid, userTweetList, score, tweetID); err != nil {
		return respErr(err), nil
	}
	if err := c.zadd(userSid, userFollowingsTweets, score, tweetID); err != nil {
		return respErr(err), nil
	}

	// A retweet points at the quoted tweet. Pulling that tweet here is
	// best-effort: it may have been deleted, or live on an unreachable node, and
	// the retweet is still valid without it.
	if originalID := tweet.originalTweetID(); originalID != "" {
		if err := c.addRef(authSid, authorID, originalID); err != nil {
			c.errorf("Error sync original tweet: %v, tweet=%s", err, jsonStringify(map[string]any(tweet)))
		} else {
			c.syncBestEffort(authSid, originalID)
		}
	}

	if err := c.addRef(authSid, authorID, tweetID); err != nil {
		return respErr(err), nil
	}
	if err := c.backupDelRef(authSid, authorID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, authorID); err != nil {
		c.warnf("publish %s failed: %v", authorID, err)
	}

	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  authorID,
		reqMID:    authorID,
	}); err != nil {
		c.warnf("node_update_score failed: %v", err)
	}

	c.infof("local %s", jsonStringify(map[string]any(tweet)))
	return c.wrapPassthrough(map[string]any{"success": true, "mid": tweetID}), nil
}

// authorizePost decides whether a posting request may proceed.
func (c *ctx) authorizePost(tweet tweetObj, user userObj, agentAuth map[string]any) error {
	if agentAuth != nil {
		// The signature covers the author and content, so an agent cannot take a
		// signature issued for one user and post as another.
		result := c.verifyAgentAuth(agentAuth, map[string]any{
			"authorId": tweet.authorID(),
			"content":  tweet.content(),
		})
		if !result.valid {
			c.warnf("Agent authentication failed: %s", result.reason)
			return fmt.Errorf("Agent authentication failed: %s", result.reason)
		}
		if result.mimeiID != tweet.authorID() {
			return fmt.Errorf("Agent cannot post as different user")
		}
		c.infof("Agent authentication successful for user %s", tweet.authorID())
		c.debugf("Authorized via agent")
		return nil
	}

	friendID, err := c.friendByAppCode(c.str("nodeappcode"), user.hostID())
	if err != nil {
		return err
	}
	c.debugf("friendId=%s", friendID)
	if friendID == "" {
		return fmt.Errorf("Not authorized to post")
	}
	c.debugf("Authorized via friend")
	return nil
}

// ---------------------------------------------------------------------------
// get_tweet
// ---------------------------------------------------------------------------

// entryGetTweet reads a tweet together with the viewer's interaction flags.
//
// This is the routine read path and it stays on this node: it returns whatever
// copy is held here rather than forcing a synchronisation, which is what makes
// timelines fast. refresh_tweet is the explicit recovery path for stale data.
//
// The exception is a detail view, which is the one place a user is looking
// closely enough for stale counts to be visible; see fromdetailview below.
func entryGetTweet(c *ctx) (any, error) {
	tweetID := c.str("tweetid")
	appUserID := c.str("appuserid")

	mmsid, err := c.api.MMOpen("", tweetID, verLast)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer func() { c.closeMimei(mmsid) }()

	stored, err := c.getObject(mmsid, tweetContentKey)
	if err != nil {
		return c.wrapErr(err), nil
	}
	if stored == nil {
		return c.wrapNotNull(nil, "Tweet not found"), nil
	}
	tweet := tweetObj(stored)

	// Opening a tweet's detail view on a node that is not the author's is the
	// one read worth a synchronisation, because the user is looking at the
	// counts directly. Doing it only when this node is not already a provider
	// keeps it to once per node per tweet.
	//
	// The flag arrives as a string: request parameters are always strings, so a
	// bare truthiness test would treat "false" as true.
	if c.str("fromdetailview") == "true" && tweet.authorID() != "" {
		if refreshed, newSid := c.syncForDetailView(tweetID, tweet, mmsid); refreshed != nil {
			tweet, mmsid = refreshed, newSid
		}
	}

	isFavorite, err := c.hhas(mmsid, tweetLikeList, appUserID)
	if err != nil {
		return c.wrapErr(err), nil
	}
	isBookmarked, err := c.hhas(mmsid, tweetBookmarkList, appUserID)
	if err != nil {
		return c.wrapErr(err), nil
	}
	hasRetweeted, err := c.hhas(mmsid, tweetRetweetList, appUserID)
	if err != nil {
		return c.wrapErr(err), nil
	}

	bookmarkCount, err := c.hlen(mmsid, tweetBookmarkList)
	if err != nil {
		return c.wrapErr(err), nil
	}
	favoriteCount, err := c.hlen(mmsid, tweetLikeList)
	if err != nil {
		return c.wrapErr(err), nil
	}
	commentCount, err := c.zcard(mmsid, tweetCommentList)
	if err != nil {
		return c.wrapErr(err), nil
	}
	retweetCount, err := c.hlen(mmsid, tweetRetweetList)
	if err != nil {
		return c.wrapErr(err), nil
	}

	ret := map[string]any{
		"mid":              tweet["mid"],
		"authorId":         tweet["authorId"],
		"title":            tweet["title"],
		"attachments":      tweet["attachments"],
		"isPrivate":        tweet["isPrivate"],
		"downloadable":     tweet["downloadable"],
		"originalTweetId":  tweet["originalTweetId"],
		"originalAuthorId": tweet["originalAuthorId"],
		"parentTweetId":    tweet["parentTweetId"],
		"timestamp":        tweet["timestamp"],
		"contentType":      tweet["contentType"],

		"bookmarkCount": bookmarkCount,
		"favoriteCount": favoriteCount,
		"commentCount":  commentCount,
		"retweetCount":  retweetCount,

		// [isFavorite, isBookmarked, hasRetweeted] for the requesting user.
		"favorites": []any{isFavorite, isBookmarked, hasRetweeted},
	}
	// Only set when present, so an absent content field does not become "".
	if content := tweet.content(); content != "" {
		ret["content"] = content
	}

	if c.isV3() {
		// v3 returns the tweet followed by the tweet it quotes, so a client can
		// render a retweet without a second round trip.
		//
		// Note: the quoted tweet is fetched with version=v3 as well, so it
		// arrives already wrapped in its own one-element list and is appended
		// as a nested list. This mirrors the previous implementation exactly;
		// changing it would change what v3 clients parse.
		result := []any{ret}
		if originalID := tweet.originalTweetID(); originalID != "" {
			original, err := c.callEntry("get_tweet", map[string]string{
				reqAppID:         c.appID(),
				reqAppVer:        verLast,
				"tweetid":        originalID,
				"appuserid":      appUserID,
				reqVersion:       c.version(),
				"fromdetailview": c.str("fromdetailview"),
			})
			if err == nil && original != nil {
				result = append(result, original)
			}
		}
		return c.wrapNotNull(result, "Tweet not found"), nil
	}
	return c.wrapNotNull(ret, "Tweet not found"), nil
}

// syncForDetailView pulls a tweet from its author's node when this node does
// not already serve it, and returns the refreshed tweet and handle. It returns
// (nil, "") when nothing changed, leaving the caller's handle in place.
//
// Every failure here is contained: a detail view that shows a slightly stale
// tweet is better than one that shows an error.
func (c *ctx) syncForDetailView(tweetID string, tweet tweetObj, mmsid string) (tweetObj, string) {
	// The caller usually knows the author's node already. Looking it up here
	// would read the author's account, which this node is not guaranteed to
	// hold.
	writeHostID := c.str("authorhostid")
	if writeHostID == "" {
		author, err := c.callEntryMap("get_user_core_data", map[string]string{
			reqAppID:  c.appID(),
			reqAppVer: verLast,
			"userid":  tweet.authorID(),
		})
		if err != nil {
			c.errorf("fromdetailview sync failed for %s: %v", tweetID, err)
			return nil, ""
		}
		writeHostID = userObj(author).hostID()
	}
	nodeID := c.nodeID()
	if writeHostID == "" || writeHostID == nodeID {
		return nil, ""
	}

	systemSid, err := c.nodeDataSid(verCur)
	if err != nil {
		c.errorf("fromdetailview sync failed for %s: %v", tweetID, err)
		return nil, ""
	}
	isProvider, err := c.mimeiIsProvider(systemSid, tweetID)
	if err != nil {
		c.errorf("fromdetailview sync failed for %s: %v", tweetID, err)
		return nil, ""
	}
	c.debugf("tweetId=%s isProvider=%t on nodeId=%s (writeHostId=%s)", tweetID, isProvider, nodeID, writeHostID)
	if isProvider {
		return nil, ""
	}

	c.debugf("fromdetailview syncing tweetId=%s, not yet a provider on nodeId=%s (writeHostId=%s)",
		tweetID, nodeID, writeHostID)
	if err := c.mimeiSync(tweetID, nil); err != nil {
		c.errorf("fromdetailview sync failed for %s: %v", tweetID, err)
		return nil, ""
	}
	if err := c.mimeiProvide(systemSid, tweetID); err != nil {
		c.warnf("provide %s failed: %v", tweetID, err)
	}

	newSid, err := c.api.MMOpen("", tweetID, verLast)
	if err != nil {
		c.errorf("fromdetailview sync failed for %s: %v", tweetID, err)
		return nil, ""
	}
	refreshed, err := c.getObject(newSid, tweetContentKey)
	if err != nil {
		c.errorf("fromdetailview sync failed for %s: %v", tweetID, err)
		c.closeMimei(newSid)
		return nil, ""
	}
	c.closeMimei(mmsid)
	if refreshed == nil {
		// The synchronised copy has no content; keep the one already read.
		return tweet, newSid
	}
	return tweetObj(refreshed), newSid
}

// ---------------------------------------------------------------------------
// refresh_tweet
// ---------------------------------------------------------------------------

// entryRefreshTweet pulls a tweet from its author's node and returns it.
//
// This is an explicit recovery path attached to pull-to-refresh. Synchronising
// a tweet carries its direct comments but not their replies, so a client still
// calls get_comments afterwards to load what arrived.
func entryRefreshTweet(c *ctx) (any, error) {
	tweetID := c.str("tweetid")
	hostID := c.str("hostid")
	authorID := c.str("userid")
	appUserID := c.str("appuserid")

	if nodeID := c.nodeID(); nodeID != hostID {
		c.debugf("tweetId=%s on nodeId=%s from hostId=%s", tweetID, nodeID, hostID)
		if _, err := c.callEntry("node_update_mid_by_score", map[string]string{
			reqAppID:  c.appID(),
			reqAppVer: verLast,
			"hostid":  hostID,
			"userid":  authorID,
			reqMID:    tweetID,
		}); err != nil {
			c.errorf("Failed to update mid by score for tweetId=%s: %v", tweetID, err)
		}
	}

	// Asked for in v2 so the reply states whether the tweet was found.
	resp, err := c.callEntryMap("get_tweet", map[string]string{
		reqAppID:    c.appID(),
		reqAppVer:   verLast,
		reqVersion:  versionV2,
		"appuserid": appUserID,
		"tweetid":   tweetID,
	})
	if err != nil {
		return c.wrapErr(err), nil
	}
	var tweet any
	if resp != nil && mapBool(resp, "success") {
		tweet = resp["data"]
	}
	return c.wrapNotNull(tweet, "Tweet not found"), nil
}

// ---------------------------------------------------------------------------
// delete_tweet
// ---------------------------------------------------------------------------

// entryDeleteTweet removes a tweet, or removes it from one user's lists.
//
// Only the author deletes the tweet itself. For anyone else the request means
// "take this out of my lists", which leaves the tweet intact for everyone else.
// Both cases run on the requesting user's root node, because both write to that
// user's account.
func entryDeleteTweet(c *ctx) (any, error) {
	tweetID := c.str("tweetid")

	// v3 names the requester and the author separately. Earlier clients
	// overloaded "userid" for both and passed the requester as "appuserid".
	var userID, tweetAuthorID string
	if c.isV3() {
		userID = c.str("userid")
		tweetAuthorID = c.str("authorid")
	} else {
		userID = firstNonEmpty(c.str("appuserid"), c.str("userid"))
		tweetAuthorID = firstNonEmpty(c.str("authorid"), c.str("userid"))
	}
	if tweetID == "" || userID == "" || tweetAuthorID == "" {
		return respErr(fmt.Errorf("Missing delete_tweet requester, author, or tweet ID")), nil
	}

	user, err := c.loadUser(userID)
	if err != nil {
		c.errorf("getUser failed for mid=%s: %v", userID, err)
		return respErr(err), nil
	}
	if user == nil || !user.hasValidHost() {
		c.errorf("missing host for user %s", jsonStringify(map[string]any{
			"userId": userID, "nodeId": c.nodeID(),
		}))
		return respErr(fmt.Errorf("User host not found")), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	userSid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", userID, err)), nil
	}
	defer c.closeMimei(userSid)

	var deleted tweetObj
	if tweetAuthorID == userID {
		deleted, err = c.destroyTweet(authSid, userSid, userID, tweetID)
		if err != nil {
			return respErr(err), nil
		}
	}

	// Whether or not the tweet itself was destroyed, it leaves this user's
	// lists.
	if err := c.zrem(userSid, userTweetList, tweetID); err != nil {
		return respErr(err), nil
	}
	if err := c.zrem(userSid, userFollowingsTweets, tweetID); err != nil {
		return respErr(err), nil
	}
	if err := c.hdel(userSid, userPinnedTweets, tweetID); err != nil {
		return respErr(err), nil
	}
	if err := c.zrem(userSid, userBookmarkList, tweetID); err != nil {
		return respErr(err), nil
	}
	if err := c.zrem(userSid, tweetLikeList, tweetID); err != nil {
		return respErr(err), nil
	}

	if err := c.backupDelRef(userSid, userID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, userID); err != nil {
		c.warnf("publish %s failed: %v", userID, err)
	}
	c.debugf("Delete tweet %s %s", tweetID, jsonStringify(map[string]any(deleted)))

	// Score maintenance is cleanup; its failure must not fail the deletion.
	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
		reqMID:    userID,
	}); err != nil {
		c.errorf("Failed to update user score: %v, userId=%s", err, userID)
	}

	return c.wrapDelete(map[string]any{"tweetid": tweetID, "success": true}), nil
}

// destroyTweet permanently removes a tweet the requesting user authored.
func (c *ctx) destroyTweet(authSid, userSid, userID, tweetID string) (tweetObj, error) {
	tweetSid, err := c.api.MMOpen(authSid, tweetID, verCur)
	if err != nil {
		return nil, fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)
	}
	defer c.closeMimei(tweetSid)

	stored, err := c.getObject(tweetSid, tweetContentKey)
	if err != nil {
		return nil, err
	}
	tweet := tweetObj(stored)
	c.debugf("tweet=%s", jsonStringify(map[string]any(tweet)))
	if stored == nil {
		return nil, fmt.Errorf("Tweet not found")
	}
	if tweet.authorID() != userID {
		return tweet, fmt.Errorf("User is not the tweet author")
	}

	// Dropping the attachment references leaves them unreferenced, and the
	// garbage collector reclaims them.
	for _, attachment := range tweet.attachments() {
		if mid := mapStr(attachment, "mid"); mid != "" {
			if err := c.delRef(tweetSid, tweetID, mid); err != nil {
				c.warnf("attachment unref %s failed: %v", mid, err)
			}
		}
	}

	if err := c.backupDelRef(tweetSid, tweetID, ""); err != nil {
		return tweet, err
	}
	if err := c.mimeiUnpublish(tweetSid, tweetID); err != nil {
		c.warnf("unpublish %s failed: %v", tweetID, err)
	}
	if err := c.delVersions(tweetSid, tweetID); err != nil {
		return tweet, err
	}

	if originalID := tweet.originalTweetID(); originalID != "" {
		if err := c.delRef(userSid, userID, originalID); err != nil {
			c.warnf("original unref %s failed: %v", originalID, err)
		}
	}
	if err := c.delRef(userSid, userID, tweetID); err != nil {
		return tweet, err
	}
	return tweet, nil
}

// wrapDelete wraps a deletion reply. Both v2 and v3 use the envelope here.
func (c *ctx) wrapDelete(result any) any {
	if m, ok := toMap(result); ok {
		if _, isEnvelope := m["success"]; isEnvelope {
			return m
		}
	}
	if c.isV2() || c.isV3() {
		return respOK(result)
	}
	return result
}
