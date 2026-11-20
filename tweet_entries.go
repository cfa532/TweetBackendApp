// tweet_entries.go — creating, reading and deleting tweets.
//
// A new tweet is its own File MiMei, stored on its author's root node. Creating
// one also records a reference from the author's account to the tweet: that
// reference, not the tweet list, is what makes the tweet travel when the account
// is synchronised to another node.
package lapp

import (
	"fmt"
	"strings"
)

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
	// The server records the source of a wrapped comment retweet after authorization.
	delete(tweet, commentRetweetSourceKey)
	delete(tweet, quotedCommentAuthorKey)

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
	// about. Clients address that node; add_comment creates a quote-comment's
	// retweet half here through createQuotedRetweet.
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
	// A client-supplied requestid makes submission idempotent: the id is
	// derived from the mark, so a retry after a lost response resolves the
	// same tweet instead of creating a second one. Without one Leither is
	// asked for a fresh id, so two tweets with identical text remain distinct
	// objects.
	requestID := c.str("requestid")
	authorID := tweet.authorID()
	originalID := tweet.originalTweetID()
	commentID := tweet.quotedCommentID()
	isCommentRetweet := c.entry == "retweet_comment"
	if isCommentRetweet && commentID == "" {
		return respFail("Retweet requires a source comment"), nil
	}
	if commentID != "" && (commentID == originalID || originalID == "" || tweet.originalAuthorID() == "") {
		return respFail("Quoted comment requires its parent tweet and author"), nil
	}
	kind := "tweet"
	if isCommentRetweet {
		kind = "comment-retweet"
	}
	tweetID, err := c.fileObjectID(authSid, "tweet", submissionMark(kind, authorID, requestID))
	if err != nil {
		return respErr(fmt.Errorf("MMCreate(tweet): %v", err)), nil
	}

	var commentQuote tweetObj
	var commentQuoteID string
	if isCommentRetweet {
		// Derive the quote's identity from the wrapper so retries converge on both records.
		commentQuoteID, err = c.fileObjectID(authSid, "tweet", submissionMark("comment-retweet-quote", authorID, tweetID))
		if err != nil {
			return respErr(fmt.Errorf("MMCreate(comment quote): %v", err)), nil
		}
		commentQuote, err = c.commentQuoteForRetweet(authSid, commentQuoteID, tweet)
		if err != nil {
			return respErr(err), nil
		}
		tweet = tweetObj{
			"authorId": authorID, "originalTweetId": commentQuoteID, "originalAuthorId": authorID,
			"isPrivate": commentQuote.isPrivate(),
			commentRetweetSourceKey: map[string]any{
				"originalTweetId": originalID, "originalAuthorId": commentQuote.originalAuthorID(),
				"quotedCommentId": commentID,
			},
		}
	}
	tweetCommitted, err := c.commitSubmission(authSid, tweetID, requestID, tweet, originalID != "")
	if err != nil {
		return respErr(err), nil
	}
	authorLists := false
	if tweetCommitted {
		if authorLists, err = c.listedInCommitted(authorID, userTweetList, tweetID); err != nil {
			return respErr(err), nil
		}
	}
	if commentQuote != nil {
		if _, err := c.commitSubmission(authSid, commentQuoteID, tweetID, commentQuote, true); err != nil {
			return respErr(err), nil
		}
	}
	if !authorLists {
		if err := c.linkSubmittedTweet(authSid, authorID, tweetID, tweet); err != nil {
			return respErr(err), nil
		}
	}

	if commentQuoteID != "" {
		// Both author references are committed before the quote is published.
		// Publish the quote first so remote readers can resolve the wrapper.
		if err := c.mimeiPublish(authSid, commentQuoteID); err != nil {
			return respErr(fmt.Errorf("publish comment quote: %v", err)), nil
		}
	}

	c.infof("local %s", jsonStringify(map[string]any(tweet)))
	if originalID != "" {
		originalHost := c.str("originalauthorhostid")
		c.afterCommit(func(work *ctx) {
			work.publishCommitted(authSid, tweetID)
			work.publishCommitted(authSid, authorID)
			work.deliverQuoteRetweetState(authSid, authorID, tweetID, tweet, originalHost)
			work.ensureProvided(authSid, originalID)
		})
	}
	result := map[string]any{"success": true, "mid": tweetID}
	if commentQuoteID != "" {
		result["commentQuoteId"] = commentQuoteID
	}
	return c.wrapPassthrough(result), nil
}

// commentQuoteForRetweet copies the stored comment and preserves that snapshot on retry.
func (c *ctx) commentQuoteForRetweet(authSid, quoteID string, draft tweetObj) (tweetObj, error) {
	committed, err := c.hasCommittedVersion(authSid, quoteID)
	if err != nil {
		return nil, err
	}
	if committed {
		quote, err := c.loadTweet(quoteID)
		if err != nil {
			return nil, err
		}
		if quote.authorID() != draft.authorID() || quote.quotedCommentID() != draft.quotedCommentID() ||
			quote.originalTweetID() != draft.originalTweetID() || quote.originalAuthorID() != draft.originalAuthorID() ||
			quote.isPrivate() != draft.isPrivate() {
			return nil, fmt.Errorf("%s", submissionConflict)
		}
		return quote, nil
	}

	host := c.str("originalauthorhostid")
	if host == "" {
		host, err = c.userHostID(draft.originalAuthorID())
		if err != nil {
			return nil, err
		}
	}
	comment, err := c.readCommentRetweetSource(authSid, host, draft.quotedCommentID(), draft.authorID())
	if err != nil {
		return nil, err
	}
	if comment.authorID() == "" || mapStr(comment, "parentTweetId") != draft.originalTweetID() {
		return nil, fmt.Errorf("Comment does not belong to the quoted parent")
	}
	parent, err := c.readCommentRetweetSource(authSid, host, draft.originalTweetID(), draft.authorID())
	if err != nil {
		return nil, err
	}
	if parent.authorID() != draft.originalAuthorID() {
		return nil, fmt.Errorf("Quoted parent does not belong to the named author")
	}
	if parent.isPrivate() || comment.isPrivate() {
		return nil, fmt.Errorf("A private comment or its private parent cannot be forwarded")
	}

	quote := tweetObj{
		"authorId": draft.authorID(), "originalTweetId": draft.originalTweetID(),
		"originalAuthorId": draft.originalAuthorID(), "quotedCommentId": draft.quotedCommentID(),
		quotedCommentAuthorKey: comment.authorID(), "isPrivate": draft.isPrivate(),
	}
	for _, key := range []string{"content", "title", "attachments", "downloadable"} {
		if value, ok := comment[key]; ok && value != nil {
			quote[key] = value
		}
	}
	return quote, nil
}

func (c *ctx) readCommentRetweetSource(authSid, host, mid, viewerID string) (tweetObj, error) {
	if host == c.nodeID() {
		return c.loadTweet(mid)
	}
	reply, err := c.callRemote(host, "get_tweet", map[string]string{
		reqAppID: c.appID(), reqAppVer: verLast, reqVersion: versionV2, reqSid: authSid,
		"tweetid": mid, "appuserid": viewerID,
	})
	if err != nil {
		return nil, err
	}
	envelope, _ := toMap(reply)
	data, _ := toMap(envelope["data"])
	if !mapBool(envelope, "success") || mapStr(data, "mid") != mid {
		return nil, fmt.Errorf("Comment retweet source %s is unavailable", mid)
	}
	return tweetObj(data), nil
}

// linkSubmittedTweet commits the author's lists and native references after
// the tweet has committed. A retry uses the original submission timestamp.
func (c *ctx) linkSubmittedTweet(authSid, authorID, tweetID string, tweet tweetObj) error {
	userSid, err := c.openMimei(authSid, authorID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", authorID, err)
	}
	defer c.closeMimei(userSid)

	score := tweet.timestamp()
	if err := c.zadd(userSid, userTweetList, score, tweetID); err != nil {
		return err
	}
	if err := c.zadd(userSid, userFollowingsTweets, score, tweetID); err != nil {
		return err
	}
	originalID := tweet.originalTweetID()
	if source := tweet.commentRetweetSource(); source != nil {
		// The generated quote is an authored tweet, even though only the retweet is listed.
		if err := c.addRef(authSid, authorID, originalID); err != nil {
			return err
		}
		originalID = source.originalTweetID()
	}
	if originalID != "" {
		if err := c.addRef(authSid, authorID, originalID); err != nil {
			c.errorf("Error sync original tweet: %v, tweet=%s", err, jsonStringify(map[string]any(tweet)))
		}
	}
	if err := c.addRef(authSid, authorID, tweetID); err != nil {
		return err
	}
	if err := c.backupDelRef(authSid, authorID, ""); err != nil {
		return err
	}
	if tweet.originalTweetID() == "" {
		c.publishCommitted(authSid, authorID)
	}
	return nil
}

const submissionConflict = "requestid already names a different submission"

// commitSubmission reports whether an earlier attempt committed the object.
// A replay validates the stored payload before the caller touches its parent.
func (c *ctx) commitSubmission(authSid, mid, requestID string, submission tweetObj, deferPublish bool) (bool, error) {
	if requestID != "" {
		committed, err := c.hasCommittedVersion(authSid, mid)
		if err != nil {
			return false, err
		}
		if committed {
			return true, c.readMimei(authSid, mid, func(mmsid string) error {
				stored, err := c.getObject(mmsid, tweetContentKey)
				if err != nil {
					return err
				}
				if stored == nil {
					return fmt.Errorf("committed submission %s has no content", mid)
				}
				if submissionPayload(stored) != submissionPayload(submission) {
					return fmt.Errorf("%s", submissionConflict)
				}
				submission["mid"] = mid
				submission["timestamp"] = stored["timestamp"]
				return nil
			})
		}
	}

	mmsid, err := c.openMimei(authSid, mid, verCur)
	if err != nil {
		return false, fmt.Errorf("MMOpen(%s, cur): %v", mid, err)
	}
	defer c.closeMimei(mmsid)
	submission["mid"] = mid
	submission["timestamp"] = nowMillis()
	if err := c.setValue(mmsid, tweetContentKey, map[string]any(submission)); err != nil {
		return false, err
	}
	for _, attachment := range submission.attachments() {
		for _, child := range mediaMids(attachment) {
			if err := c.addRef(authSid, mid, child); err != nil {
				c.warnf("attachment ref %s failed: %v", child, err)
			}
		}
	}
	if err := c.backupDelRef(authSid, mid, ""); err != nil {
		return false, err
	}
	if !deferPublish {
		c.publishCommitted(authSid, mid)
	}
	return false, nil
}

func submissionPayload(submission map[string]any) string {
	core := fileCoreRecord(tweetContentKey, submission)
	delete(core, "mid")
	delete(core, "timestamp")
	return jsonStringify(core)
}

// submissionMark turns a client's requestid into the creation mark of the
// object it names. The mark is what the object's id is derived from, so it
// carries the kind and the author as well: one user's requestid can then never
// resolve to another user's object, nor a comment's to a tweet's, however the
// two were chosen. No requestid asks Leither for a fresh id.
func submissionMark(kind, authorID, requestID string) string {
	if requestID == "" {
		return "{{auto}}"
	}
	return kind + ":" + authorID + ":" + requestID
}

// authorizePost decides whether a posting request may proceed.
func (c *ctx) authorizePost(tweet tweetObj, user userObj, agentAuth map[string]any) error {
	if agentAuth != nil {
		// The signature covers the author and content, so an agent cannot take a
		// signature issued for one user and post as another.
		//
		// Keep legacy verification for accounts that have not opted out.
		result := c.verifyAgentAuth(agentAuth, map[string]any{
			"authorId": tweet.authorID(),
			"content":  tweet.content(),
		}, !user.adminTweetAccessRevoked())
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

	if user.adminTweetAccessRevoked() {
		return c.requireBoundOwner(user, tweet.authorID())
	}

	// No app code means the request came from a client rather than a peer
	// node, so the caller must be the author it names.
	if c.str("nodeappcode") == "" {
		if err := c.requireOwner(tweet.authorID()); err != nil {
			return err
		}
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
	if c.str("fromdetailview") == "true" && stored == nil && (err == nil || missingLocalTweet(err)) {
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

	isFavorite, isBookmarked, viewerSavedStateAtRoot, viewerSavedStateKnown := c.viewerSavedFlags(appUserID, tweetID)
	if !viewerSavedStateKnown {
		// Older clients still use the tweet-side snapshot where the viewer's
		// account isn't available. New clients can keep confirmed local flags.
		isFavorite, err = c.hhas(mmsid, tweetLikeList, appUserID)
		if err != nil {
			return c.wrapErr(err), nil
		}
		isBookmarked, err = c.hhas(mmsid, tweetBookmarkList, appUserID)
		if err != nil {
			return c.wrapErr(err), nil
		}
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
		"favorites":              []any{isFavorite, isBookmarked, hasRetweeted},
		"viewerSavedStateAtRoot": viewerSavedStateAtRoot,
	}
	if format := mapStr(tweet, "storageFormat"); format != "" {
		ret["storageFormat"] = format
	}
	if sourceAuthor := mapStr(tweet, quotedCommentAuthorKey); sourceAuthor != "" {
		ret[quotedCommentAuthorKey] = sourceAuthor
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

// missingLocalTweet recognizes Leither's local metadata and File version
// misses. Permission and storage failures reach the caller directly.
func missingLocalTweet(err error) bool {
	message := err.Error()
	return strings.Contains(message, "30000:No MiMei mid[") || strings.Contains(message, "OpenMM ver is empty")
}

// pullTweetForDetailView fetches a tweet this node does not hold yet, for a
// detail view served by an access node. It reports whether the pull ran, so the
// caller knows a second read is worthwhile.
//
// A pull requires a known root host other than this node. The author's root
// host comes from the client's
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
	if err := c.mimeiSync(authSid, tweetID, writeHostID); syncStillRunning(err) {
		c.debugf("fromdetailview sync continues tweetId=%s hostId=%s", tweetID, writeHostID)
		return true
	} else if err != nil {
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
			err = c.mimeiSync(authSid, tweetID, hostID)
		}
		if syncStillRunning(err) {
			c.debugf("tweet sync continues tweetId=%s hostId=%s", tweetID, hostID)
		} else if err != nil {
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
	if tweetAuthorID == userID && user.adminTweetAccessRevoked() {
		err = c.requireBoundOwner(user, userID)
	} else {
		err = c.requireOwner(userID)
	}
	if err != nil {
		return respErr(err), nil
	}
	return c.deleteTweet(userID, tweetAuthorID, tweetID, true)
}

func (c *ctx) deleteTweet(userID, tweetAuthorID, tweetID string, updateOriginal bool) (any, error) {
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
	c.debugf("Delete tweet %s %s", tweetID, jsonStringify(map[string]any(deleted)))
	if updateOriginal && deleted.originalTweetID() != "" {
		c.afterCommit(func(work *ctx) {
			work.publishCommitted(authSid, userID)
			work.deliverQuoteRetweetState(authSid, userID, tweetID, deleted, "")
		})
	} else {
		c.publishCommitted(authSid, userID)
	}

	return c.wrapDelete(map[string]any{"tweetid": tweetID, "success": true, "peerUpdateDeferred": true}), nil
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
		for _, mid := range mediaMids(attachment) {
			if err := c.delRef(authSid, tweetID, mid); err != nil {
				c.warnf("attachment unref %s failed: %v", mid, err)
			}
		}
	}

	if err := c.delVersions(authSid, tweetID); err != nil {
		return tweet, err
	}

	// The generated quote has its own author reference and can be opened independently.
	if originalID := tweet.originalTweetID(); originalID != "" && tweet.commentRetweetSource() == nil {
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
