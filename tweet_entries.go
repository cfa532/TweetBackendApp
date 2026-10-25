// tweet_entries.go — creating, reading and deleting tweets.
//
// A new tweet is its own File MiMei, stored on its author's root node. Creating
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
// The tweet is written on its author's root node, which the client addresses
// directly; a request that reached any other node is refused below. The caller
// must also be authorised, either as a peer node holding a valid app code or as
// an agent with a signature over the request.
//
// The author's account is loaded once and serves three purposes: rejecting a
// tweet whose author this node does not know, deciding the routing check, and
// supplying the host used when attributing a front-end request in
// authorizePost.
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
	// The tweet is stored on its author's root node and referenced by their
	// account, so creating it anywhere else writes a copy the root never learns
	// about. Clients address that node; add_comment reaches it through
	// createQuotedRetweet.
	if err := c.requireRootNodeFor(user, tweet.authorID()); err != nil {
		return respErr(err), nil
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
	tweetID, err := c.fileObjectID(authSid, "tweet", "{{auto}}")
	if err != nil {
		return respErr(fmt.Errorf("MMCreate(tweet): %v", err)), nil
	}

	tweetSid, err := c.openMimei(authSid, tweetID, verCur)
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
	userSid, err := c.openMimei(authSid, authorID, verCur)
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

	// A retweet points at the quoted tweet. Registering its provider role is
	// best-effort; Leither synchronizes the quoted tweet after registration.
	if originalID := tweet.originalTweetID(); originalID != "" {
		if err := c.addRef(authSid, authorID, originalID); err != nil {
			c.errorf("Error sync original tweet: %v, tweet=%s", err, jsonStringify(map[string]any(tweet)))
		} else {
			c.ensureProvided(authSid, originalID)
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

	c.infof("local %s", jsonStringify(map[string]any(tweet)))
	return c.wrapPassthrough(map[string]any{"success": true, "mid": tweetID}), nil
}

// authorizePost decides whether a posting request may proceed.
func (c *ctx) authorizePost(tweet tweetObj, user userObj, agentAuth map[string]any) error {
	if agentAuth != nil {
		// The signature covers the author and content, so an agent cannot take a
		// signature issued for one user and post as another.
		//
		// A well-formed but unverifiable signature is accepted here, as
		// add_tweet.js did; verify_agent_token refuses the same signature.
		result := c.verifyAgentAuth(agentAuth, map[string]any{
			"authorId": tweet.authorID(),
			"content":  tweet.content(),
		}, true)
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
// A detail-view read also lets a non-root access node announce itself as a
// provider, and pulls the tweet first when the node does not hold it yet; see
// fromdetailview below.
func entryGetTweet(c *ctx) (any, error) {
	tweetID := c.str("tweetid")
	appUserID := c.str("appuserid")

	mmsid, stored, err := c.readTweetContent(tweetID)

	// A detail view opened on an access node that has no data for the tweet yet:
	// the node provides the author but Leither has not replicated this tweet to it.
	// Pull the tweet now and become its provider, then read it again. Only the
	// detail view does this; a routine read keeps answering from the local copy.
	if (err != nil || stored == nil) && c.str("fromdetailview") == "true" {
		if c.pullTweetForDetailView(tweetID) {
			c.closeMimei(mmsid)
			mmsid, stored, err = c.readTweetContent(tweetID)
		}
	}
	defer func() { c.closeMimei(mmsid) }()
	if err != nil {
		return c.wrapErr(err), nil
	}
	if stored == nil {
		return c.wrapNotNull(nil, "Tweet not found"), nil
	}
	tweet := tweetObj(stored)

	// Opening a tweet's detail view lets a node that is not the author's root
	// become a provider. MiMeiProvide handles synchronization inside Leither;
	// the backend only needs to avoid repeating the announcement when this node
	// already provides the tweet.
	//
	// The flag arrives as a string: request parameters are always strings, so a
	// bare truthiness test would treat "false" as true.
	if c.str("fromdetailview") == "true" && tweet.authorID() != "" {
		if refreshed, newSid := c.provideForDetailView(tweetID, tweet, mmsid); refreshed != nil {
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
	if format := mapStr(tweet, "storageFormat"); format != "" {
		ret["storageFormat"] = format
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
			// The quoted tweet belongs to another user, so the caller's
			// authorhostid does not apply. authorid lets the call find that
			// user's root host if it has to pull the quoted tweet.
			original, err := c.callEntry("get_tweet", map[string]string{
				reqAppID:         c.appID(),
				reqAppVer:        verLast,
				"tweetid":        originalID,
				"appuserid":      appUserID,
				reqVersion:       c.version(),
				"fromdetailview": c.str("fromdetailview"),
				"authorid":       tweet.originalAuthorID(),
			})
			if err == nil && original != nil {
				result = append(result, original)
			}
		}
		return c.wrapNotNull(result, "Tweet not found"), nil
	}
	return c.wrapNotNull(ret, "Tweet not found"), nil
}

// readTweetContent opens a tweet and reads its content. The handle is returned
// open when the read succeeds, including when the node holds no content (nil
// stored); on error it is already closed and the returned handle is empty.
func (c *ctx) readTweetContent(tweetID string) (string, map[string]any, error) {
	mmsid, err := c.openMimei("", tweetID, verLast)
	if err != nil {
		return "", nil, err
	}
	stored, err := c.getObject(mmsid, tweetContentKey)
	if err != nil {
		c.closeMimei(mmsid)
		return "", nil, err
	}
	return mmsid, stored, nil
}

// pullTweetForDetailView fetches a tweet this node does not hold yet, for a
// detail view served by an access node. It reports whether the pull ran, so the
// caller knows a second read is worthwhile.
//
// It does nothing when the node is the author's root host: the root is where the
// tweet is written, so a tweet missing there does not exist and a sync would
// have nowhere to pull from. The author's root host comes from the client's
// authorhostid (or, for a quoted tweet, from its author's account via authorid)
// because the tweet, which would name its author, is not here to read.
//
// This forces mimeiSync on a read, which the contract otherwise reserves for
// explicit recovery (refresh_tweet). It is allowed here because the alternative
// is a "not found" for a tweet Leither has simply not delivered yet, and it runs
// only on a miss, never on a read the node can already serve.
func (c *ctx) pullTweetForDetailView(tweetID string) bool {
	writeHostID, err := c.authorRootHostID(c.str("authorid"))
	if err != nil {
		c.errorf("fromdetailview pull failed for %s: %v", tweetID, err)
		return false
	}
	nodeID := c.nodeID()
	if writeHostID == "" || nodeID == "" || writeHostID == nodeID {
		return false
	}

	authSid, err := c.authSid()
	if err != nil {
		c.errorf("fromdetailview pull failed for %s: %v", tweetID, err)
		return false
	}
	c.debugf("fromdetailview pulling absent tweetId=%s on nodeId=%s from writeHostId=%s",
		tweetID, nodeID, writeHostID)
	if err := c.mimeiSync(authSid, tweetID, nil); err != nil {
		c.errorf("fromdetailview sync failed for %s: %v", tweetID, err)
		return false
	}
	c.ensureProvided(authSid, tweetID)
	return true
}

// authorRootHostID returns the root host of the author a detail read concerns.
//
// The caller usually knows it already and sends it as authorhostid; looking it up
// instead reads the author's account, which this node is not guaranteed to hold.
// Without authorhostid the account is read, and with no authorID either the host
// is unknown and "" is returned.
func (c *ctx) authorRootHostID(authorID string) (string, error) {
	if hostID := c.str("authorhostid"); hostID != "" {
		return hostID, nil
	}
	if authorID == "" {
		return "", nil
	}
	author, err := c.callEntryMap("get_user_core_data", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  authorID,
	})
	if err != nil {
		return "", err
	}
	return userObj(author).hostID(), nil
}

// provideForDetailView makes this node a provider when it is neither the author's
// root host nor already serving the tweet. MiMeiProvide performs Leither's
// synchronization internally, so this path must not call MiMeiSync itself.
// It returns the refreshed tweet and handle, or (nil, "") when nothing changed.
//
// Every failure here is contained: a detail view that shows a slightly stale
// tweet is better than one that shows an error.
func (c *ctx) provideForDetailView(tweetID string, tweet tweetObj, mmsid string) (tweetObj, string) {
	writeHostID, err := c.authorRootHostID(tweet.authorID())
	if err != nil {
		c.errorf("fromdetailview provider setup failed for %s: %v", tweetID, err)
		return nil, ""
	}
	nodeID := c.nodeID()
	if writeHostID == "" || writeHostID == nodeID {
		return nil, ""
	}

	authSid, err := c.authSid()
	if err != nil {
		c.errorf("fromdetailview provider setup failed for %s: %v", tweetID, err)
		return nil, ""
	}
	isProvider, err := c.mimeiIsProvider(authSid, tweetID)
	if err != nil {
		c.errorf("fromdetailview provider setup failed for %s: %v", tweetID, err)
		return nil, ""
	}
	c.debugf("tweetId=%s isProvider=%t on nodeId=%s (writeHostId=%s)", tweetID, isProvider, nodeID, writeHostID)
	if isProvider {
		return nil, ""
	}

	c.debugf("fromdetailview providing tweetId=%s on nodeId=%s (writeHostId=%s)",
		tweetID, nodeID, writeHostID)
	if err := c.mimeiProvide(authSid, tweetID); err != nil {
		c.warnf("provide %s failed: %v", tweetID, err)
	}

	newSid, err := c.openMimei("", tweetID, verLast)
	if err != nil {
		c.errorf("fromdetailview provider setup failed for %s: %v", tweetID, err)
		return nil, ""
	}
	refreshed, err := c.getObject(newSid, tweetContentKey)
	if err != nil {
		c.errorf("fromdetailview provider setup failed for %s: %v", tweetID, err)
		c.closeMimei(newSid)
		return nil, ""
	}
	c.closeMimei(mmsid)
	if refreshed == nil {
		// The provider copy has no content; keep the one already read.
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
	appUserID := c.str("appuserid")

	// Explicit user refresh: force the pull now instead of waiting for Leither's
	// background replication. A failed pull is not fatal; get_tweet below still
	// answers from whatever copy this node has.
	if nodeID := c.nodeID(); nodeID != hostID {
		c.debugf("tweetId=%s on nodeId=%s from hostId=%s", tweetID, nodeID, hostID)
		authSid, err := c.authSid()
		if err == nil {
			err = c.mimeiSync(authSid, tweetID, nil)
		}
		if err != nil {
			c.errorf("Failed to sync tweetId=%s from hostId=%s: %v", tweetID, hostID, err)
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
	// Both paths write the requester's own account: the author's deletes the
	// tweet, anyone else's removes it from their lists.
	if err := c.requireRootNodeFor(user, userID); err != nil {
		return respErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	userSid, err := c.openMimei(authSid, userID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", userID, err)), nil
	}
	defer c.closeMimei(userSid)

	var deleted tweetObj
	if tweetAuthorID == userID {
		deleted, err = c.destroyTweet(authSid, userID, tweetID)
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
	if err := c.hdel(userSid, userBookmarkList, tweetID); err != nil {
		return respErr(err), nil
	}
	if err := c.hdel(userSid, userFavoriteList, tweetID); err != nil {
		return respErr(err), nil
	}

	if err := c.backupDelRef(authSid, userID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, userID); err != nil {
		c.warnf("publish %s failed: %v", userID, err)
	}
	c.debugf("Delete tweet %s %s", tweetID, jsonStringify(map[string]any(deleted)))

	return c.wrapDelete(map[string]any{"tweetid": tweetID, "success": true}), nil
}

// destroyTweet permanently removes a tweet the requesting user authored.
func (c *ctx) destroyTweet(authSid, userID, tweetID string) (tweetObj, error) {
	tweetSid, err := c.openMimei(authSid, tweetID, verCur)
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

	// Withdraw the tweet before deleting its versions. Do not back up an object
	// being deleted: File backups rewrite the retained tree and require FilesRm.
	if err := c.mimeiUnpublish(authSid, tweetID); err != nil {
		return tweet, fmt.Errorf("unpublish %s: %v", tweetID, err)
	}

	// Dropping the attachment references leaves them unreferenced, and the
	// garbage collector reclaims them.
	for _, attachment := range tweet.attachments() {
		if mid := mapStr(attachment, "mid"); mid != "" {
			if err := c.delRef(authSid, tweetID, mid); err != nil {
				c.warnf("attachment unref %s failed: %v", mid, err)
			}
		}
	}

	if err := c.delVersions(authSid, tweetID); err != nil {
		return tweet, err
	}

	if originalID := tweet.originalTweetID(); originalID != "" {
		if err := c.delRef(authSid, userID, originalID); err != nil {
			c.warnf("original unref %s failed: %v", originalID, err)
		}
	}
	if err := c.delRef(authSid, userID, tweetID); err != nil {
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
