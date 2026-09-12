// comment_entries.go — comments and replies.
//
// A comment is a tweet object, but it does not live where a tweet lives. A
// comment is stored on the root node of its *parent's author*, whoever wrote
// the comment, and the parent holds a Mimei reference to it. A reply follows
// the same rule against its parent comment.
//
// Three identities are easy to confuse here, and the request parameter names do
// not help:
//
//	hostid         the parent author's root node — where the comment is written
//	tweetauthorid  the parent author's id (a legacy name: it is not the comment's author)
//	comment.authorId  the user who actually wrote the comment
//
// The client is responsible for calling the parent author's node; hostid still
// names it and is carried through for that reason. Writing a comment on the
// comment writer's node instead would put it somewhere the parent can never
// reference it.
package lapp

import "fmt"

// ---------------------------------------------------------------------------
// add_comment
// ---------------------------------------------------------------------------

// entryAddComment attaches a comment to a tweet or to another comment.
func entryAddComment(c *ctx) (any, error) {
	// tweetauthorid is the parent's author; userid is the older clients' name
	// for the same thing.
	tweetAuthorID := firstNonEmpty(c.str("tweetauthorid"), c.str("userid"))
	tweetID := c.str("tweetid")

	if tweetAuthorID == "" {
		return respErr(fmt.Errorf("Missing parent author ID: expected tweetauthorid")), nil
	}
	// A comment is stored on its parent's author's root node and referenced by
	// the parent, so this must be that node — the identity that decides it is the
	// parent's author, never the writer of the comment. All three clients send
	// add_comment to that node's writable route.
	if err := c.requireRootNode(tweetAuthorID); err != nil {
		return respErr(err), nil
	}
	comment, err := c.obj("comment")
	if err != nil {
		return respErr(err), nil
	}

	// A comment that quotes a tweet becomes two objects: a real retweet owned
	// by its writer, and the comment itself with the quote fields stripped.
	retweetID := ""
	if mapStr(comment, "originalTweetId") != "" && mapStr(comment, "originalAuthorId") != "" {
		retweetID = c.createQuotedRetweet(tweetObj(comment).authorID())
		delete(comment, "originalTweetId")
		delete(comment, "originalAuthorId")
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	commentID, err := c.api.MMCreate(authSid, c.appID(), appExt, "{{auto}}", mimeiTypeDatabase, rightUserObject)
	if err != nil {
		return respErr(fmt.Errorf("MMCreate(comment): %v", err)), nil
	}
	comment["mid"] = commentID
	comment["timestamp"] = nowMillis()

	commentSid, err := c.api.MMOpen(authSid, commentID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", commentID, err)), nil
	}
	defer c.closeMimei(commentSid)

	if err := c.setValue(commentSid, tweetContentKey, comment); err != nil {
		return respErr(err), nil
	}
	for _, attachment := range tweetObj(comment).attachments() {
		if mid := mapStr(attachment, "mid"); mid != "" {
			if err := c.addRef(commentSid, commentID, mid); err != nil {
				c.warnf("attachment ref %s failed: %v", mid, err)
			}
		}
	}
	if err := c.backupDelRef(commentSid, commentID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(commentSid, commentID); err != nil {
		c.warnf("publish %s failed: %v", commentID, err)
	}

	// The parent gains both a list entry, for paging, and a reference, which is
	// what carries the comment when the parent is synchronised. Both are
	// required; neither replaces the other.
	tweetSid, err := c.api.MMOpen(authSid, tweetID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)), nil
	}
	defer c.closeMimei(tweetSid)

	if err := c.zadd(tweetSid, tweetCommentList, nowMillis(), commentID); err != nil {
		return respErr(err), nil
	}
	if err := c.addRef(tweetSid, tweetID, commentID); err != nil {
		return respErr(err), nil
	}
	if err := c.backupDelRef(tweetSid, tweetID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.warnf("publish %s failed: %v", tweetID, err)
	}

	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  tweetAuthorID,
		reqMID:    tweetID,
	}); err != nil {
		c.warnf("node_update_score failed: %v", err)
	}

	count, err := c.commentCount(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	c.debugf("local commentCount=%d, commentId=%s, retweetId=%s", count, commentID, retweetID)
	return c.wrapPassthrough(map[string]any{
		"success":   true,
		"mid":       commentID,
		"commentId": commentID,
		"count":     count,
		"retweetid": retweetID,
	}), nil
}

// createQuotedRetweet creates the retweet half of a quote-comment, on the node
// that owns it, and returns its id.
//
// The retweet belongs to the writer of the comment, so it belongs on the
// writer's root node — and this is the parent author's node, which is a
// different one whenever someone quotes across nodes. The JavaScript entry
// could call add_tweet locally because add_tweet forwarded a misdirected
// request itself; the Go one does not forward (routing.go), so the hop is made
// here. It is the same two-owners-on-two-nodes case the other callRemote sites
// cover, and it is why add_tweet can require its own root node.
//
// Best effort, as it has always been: a comment whose quoted retweet could not
// be created is still a comment, and the caller reports an empty retweet id.
func (c *ctx) createQuotedRetweet(writerID string) string {
	writer, err := c.loadUser(writerID)
	if err != nil || writer == nil || !writer.hasValidHost() {
		c.warnf("quoted tweet creation failed: no known host for writer %s: %v", writerID, err)
		return ""
	}

	params := map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"tweet":   c.str("comment"),
	}

	var ret map[string]any
	if writerHost := writer.hostID(); writerHost == c.nodeID() {
		ret, err = c.callEntryMap("add_tweet", params)
	} else {
		systemSid, sidErr := c.nodeDataSid(verCur)
		if sidErr != nil {
			c.warnf("quoted tweet creation failed: %v", sidErr)
			return ""
		}
		params[reqSid] = systemSid
		var raw any
		raw, err = c.callRemote(writerHost, "add_tweet", params)
		ret, _ = toMap(raw)
	}
	if err != nil {
		c.warnf("quoted tweet creation failed: %v", err)
		return ""
	}
	if !mapBool(ret, "success") {
		c.warnf("quoted tweet creation failed on node %s: %s", writer.hostID(), jsonStringify(ret))
		return ""
	}
	return mapStr(ret, "mid")
}

// commentCount reads a parent's comment count from its committed version.
func (c *ctx) commentCount(tweetID string) (int64, error) {
	var count int64
	err := c.readMimei("", tweetID, func(mmsid string) error {
		n, err := c.zcard(mmsid, tweetCommentList)
		if err != nil {
			return err
		}
		count = n
		return nil
	})
	return count, err
}

// ---------------------------------------------------------------------------
// get_comments
// ---------------------------------------------------------------------------

// entryGetComments returns one page of a tweet's direct comments, newest first.
//
// A comment this node cannot resolve means one of two different things. On the
// parent author's root node it is genuinely gone, and the list entry is pruned.
// Anywhere else it has most likely not synchronised yet, so a stub carrying just
// the id is returned: the client keeps the slot and can fetch it later.
func entryGetComments(c *ctx) (any, error) {
	tweetID := c.str("tweetid")
	appUserID := c.str("appuserid")
	pageNumber := c.intParam("pn", 0)
	pageSize := c.intParam("ps", 0)
	startRank := int(pageNumber * pageSize)
	endRank := startRank + int(pageSize) - 1

	readSid, err := c.api.MMOpen("", tweetID, verLast)
	if err != nil {
		return c.wrapErrList(err), nil
	}
	defer c.closeMimei(readSid)

	parent, err := c.getObject(readSid, tweetContentKey)
	if err != nil {
		return c.wrapErrList(err), nil
	}

	isHome := false
	if authorID := tweetObj(parent).authorID(); authorID == "" {
		c.debugf("no parentTweet/authorId for tweetId=%s, skipping stale-comment cleanup", tweetID)
	} else {
		isHome = c.isHomeNode(authorID)
		c.debugf("tweetId=%s authorId=%s isHomeNode=%t", tweetID, authorID, isHome)
	}

	pairs, err := c.zrevrange(readSid, tweetCommentList, startRank, endRank)
	if err != nil {
		return c.wrapErrList(err), nil
	}

	// One slot per scanned entry, always: dropping an unresolved comment would
	// shorten the page and make the client conclude the thread had ended.
	comments := make([]any, 0, len(pairs))
	var stale []string
	for _, pair := range pairs {
		commentID := pair.Member
		if comment := c.fetchTweetV2(commentID, appUserID); comment != nil {
			comments = append(comments, comment)
			continue
		}
		if isHome {
			stale = append(stale, commentID)
			comments = append(comments, nil)
			continue
		}
		c.debugf("commentId=%s unresolved on tweetId=%s but this is not the home node; keeping stub",
			commentID, tweetID)
		comments = append(comments, map[string]any{"mid": commentID})
	}

	// Best-effort: the page is already built and must be returned regardless.
	if isHome && len(stale) > 0 {
		if err := c.pruneComments(tweetID, stale, pageNumber); err != nil {
			c.errorf("failed to remove stale commentIds for tweetId=%s: %v", tweetID, err)
		}
	}
	return c.wrap(comments), nil
}

// pruneComments removes list entries whose comment no longer exists.
func (c *ctx) pruneComments(tweetID string, commentIDs []string, page int64) error {
	authSid, err := c.authSid()
	if err != nil {
		return err
	}
	writeSid, err := c.api.MMOpen(authSid, tweetID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)
	}
	defer c.closeMimei(writeSid)

	for _, commentID := range commentIDs {
		c.warnf("removing stale commentId=%s from tweetId=%s", commentID, tweetID)
		if err := c.zrem(writeSid, tweetCommentList, commentID); err != nil {
			return err
		}
	}
	c.warnf("removed %d stale commentId(s) from tweetId=%s, page=%d", len(commentIDs), tweetID, page)
	if err := c.backupDelRef(writeSid, tweetID, ""); err != nil {
		return err
	}
	return c.mimeiPublish(authSid, tweetID)
}

// ---------------------------------------------------------------------------
// delete_comment
// ---------------------------------------------------------------------------

// entryDeleteComment removes a comment from its parent.
//
// Both the comment's author and the parent's author may delete it, so no
// authorship check is made here; the client decides who may ask. Each step is
// isolated because a partly deleted comment is worse than a fully deleted one:
// once the versions are gone, the list entry and reference must still go.
//
// The comment and the parent's list of them live on the parent author's root
// node — the same identity add_comment writes under — so that is where the
// deletion belongs. The parent is read to learn who that is, since the request
// only names the parent object.
func entryDeleteComment(c *ctx) (any, error) {
	appUserID := c.str("appuserid")
	tweetID := c.str("tweetid")
	commentID := c.str("commentid")

	parent, err := c.loadTweet(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	if parent == nil {
		return respErr(fmt.Errorf("Tweet not found")), nil
	}
	if err := c.requireRootNode(parent.authorID()); err != nil {
		return respErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}

	if err := c.destroyComment(authSid, commentID); err != nil {
		c.errorf("Failed to delete comment versions %s: %v", commentID, err)
	}
	if err := c.detachComment(authSid, tweetID, commentID); err != nil {
		c.errorf("Failed to remove comment from tweet %s: %v", tweetID, err)
	}
	if err := c.forgetSavedComment(authSid, appUserID, commentID); err != nil {
		c.errorf("Failed to remove comment from user lists %s: %v", appUserID, err)
	}
	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  appUserID,
		reqMID:    tweetID,
	}); err != nil {
		c.errorf("Failed to update tweet score %s: %v", tweetID, err)
	}

	count, err := c.commentCount(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	c.debugf("local commentCount=%d, commentId=%s", count, commentID)
	return c.wrapPassthrough(map[string]any{
		"success":   true,
		"commentId": commentID,
		"count":     count,
	}), nil
}

// destroyComment removes the comment object itself.
func (c *ctx) destroyComment(authSid, commentID string) error {
	commentSid, err := c.api.MMOpen(authSid, commentID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", commentID, err)
	}
	defer c.closeMimei(commentSid)
	return c.delVersions(commentSid, commentID)
}

// detachComment removes the parent's reference and list entry, then republishes
// the parent so other nodes stop offering the comment.
func (c *ctx) detachComment(authSid, tweetID, commentID string) error {
	tweetSid, err := c.api.MMOpen(authSid, tweetID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)
	}
	defer c.closeMimei(tweetSid)

	detachErr := c.delRef(tweetSid, tweetID, commentID)
	if err := c.zrem(tweetSid, tweetCommentList, commentID); err != nil && detachErr == nil {
		detachErr = err
	}

	// The parent is republished even if a removal failed: whatever did change
	// must become visible.
	if err := c.backupDelRef(tweetSid, tweetID, ""); err != nil {
		c.errorf("Failed to backup/publish tweet %s: %v", tweetID, err)
	} else if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.errorf("Failed to backup/publish tweet %s: %v", tweetID, err)
	}
	return detachErr
}

// forgetSavedComment drops a deleted comment from the requesting user's saved
// lists, so it does not linger as a dangling bookmark or favorite.
func (c *ctx) forgetSavedComment(authSid, appUserID, commentID string) error {
	userSid, err := c.api.MMOpen(authSid, appUserID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", appUserID, err)
	}
	defer c.closeMimei(userSid)

	if err := c.zrem(userSid, userBookmarkList, commentID); err != nil {
		return err
	}
	if err := c.zrem(userSid, tweetLikeList, commentID); err != nil {
		return err
	}
	return c.backupDelRef(userSid, appUserID, "")
}
