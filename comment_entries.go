// comment_entries.go — comments and replies.
//
// A comment is a tweet object, but it does not live where a tweet lives. A
// comment is stored on the root node of its *parent's author*, whoever wrote
// the comment, and the parent holds a Mimei reference to it. A reply follows
// the same rule against its parent comment.
//
// Who may perform that write changed with caller identity. The comment writer
// no longer sends the request to the parent author's node: a session is only
// valid on the node that issued it, and a guest's credential exists only on
// their own root. The writer calls add_comment on their own root node, signed
// by their session; that node verifies them and asks the parent author's node
// to perform the write through apply_comment, which accepts only this
// application speaking as its author identity (requireAuthorSession).
// Deletion splits the same way (delete_comment / remove_comment). The write
// into the parent is therefore performed by the parent author's own node, and
// apply_comment is where a parent author's comment policy — a tweet closed to
// comments, or open only to selected users — will be checked.
//
// Three identities are easy to confuse here, and the request parameter names do
// not help:
//
//	hostid         the parent author's root node — where the comment is written
//	tweetauthorid  the parent author's id (a legacy name: it is not the comment's author)
//	comment.authorId  the user who actually wrote the comment
//
// hostid is a routing hint for the delegation; the node that holds the parent
// re-derives the parent's author from the parent object and does not trust the
// name the caller gave.
package lapp

import "fmt"

// ---------------------------------------------------------------------------
// add_comment
// ---------------------------------------------------------------------------

// entryAddComment attaches a comment to a tweet or to another comment, called
// by the comment's writer on the writer's own root node.
func entryAddComment(c *ctx) (any, error) {
	comment, err := c.obj("comment")
	if err != nil {
		return respErr(err), nil
	}
	commentAuthorID := tweetObj(comment).authorID()
	if commentAuthorID == "" {
		return respErr(fmt.Errorf("Missing comment author ID: expected comment.authorId")), nil
	}
	// The writer's account is authoritative on this node, and the session must
	// be the writer's own — only the account's root could have issued it.
	if err := c.requireRootNode(commentAuthorID); err != nil {
		return respErr(err), nil
	}
	if err := c.requireOwner(commentAuthorID); err != nil {
		return respErr(err), nil
	}

	tweetID := c.str("tweetid")
	parentAuthorID := firstNonEmpty(c.str("tweetauthorid"), c.str("userid"))
	if tweetID == "" || parentAuthorID == "" {
		return respErr(fmt.Errorf("Missing parent: expected tweetid and tweetauthorid")), nil
	}
	// Route to the parent author's node, preferring this node's own record of
	// their account over the client's hostid hint. The target re-checks
	// everything, so a wrong hint can only fail, never misroute a write.
	parentHost := c.str("hostid")
	parentAuthor, err := c.loadUser(parentAuthorID)
	if err != nil {
		return respErr(err), nil
	}
	if parentAuthor != nil && parentAuthor.hasValidHost() {
		parentHost = parentAuthor.hostID()
	}
	if parentHost == "" {
		return respErr(fmt.Errorf("Parent author not found")), nil
	}

	// A comment that quotes a tweet becomes two objects: a real retweet owned
	// by its writer, and the comment itself with the quote fields stripped.
	// The retweet half is created before anything is delegated, so a failed
	// delegation leaves nothing half-attached on the parent author's node.
	retweetID := ""
	if mapStr(comment, "originalTweetId") != "" && mapStr(comment, "originalAuthorId") != "" {
		retweetID = c.createQuotedRetweet()
		delete(comment, "originalTweetId")
		delete(comment, "originalAuthorId")
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	reply, err := c.callCommentPeer(authSid, parentHost, "apply_comment", map[string]string{
		"tweetid":       tweetID,
		"tweetauthorid": parentAuthorID,
		"comment":       jsonStringify(comment),
	})
	if err != nil {
		return respErr(err), nil
	}
	if retweetID != "" {
		if m, ok := toMap(reply); ok {
			m["retweetid"] = retweetID
		}
	}
	// A peer failure arrives as an envelope of its own and must reach the
	// client unchanged rather than being re-labelled a local success.
	return c.wrapPassthrough(reply), nil
}

// createQuotedRetweet creates the retweet half of a quote-comment and returns
// its id. The retweet belongs to the writer of the comment, and add_comment
// runs on the writer's root node, so the tweet is created right here through
// add_tweet, which checks the writer's session itself.
//
// Best effort, as it has always been: a comment whose quoted retweet could not
// be created is still a comment, and the caller reports an empty retweet id.
func (c *ctx) createQuotedRetweet() string {
	ret, err := c.callEntryMap("add_tweet", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"tweet":   c.str("comment"),
	})
	if err != nil {
		c.warnf("quoted tweet creation failed: %v", err)
		return ""
	}
	if !mapBool(ret, "success") {
		c.warnf("quoted tweet creation failed: %s", jsonStringify(ret))
		return ""
	}
	return mapStr(ret, "mid")
}

// callCommentPeer reaches a comment peer entry on the parent author's node:
// directly when this is that node, otherwise through a cross-node call.
//
// The author session in sid survives only the local callEntry; a cross-node
// RunMApp deletes sid before the request leaves this node, and the target
// identifies its caller by the nodeappcode the platform injects there. The
// node-set author uid travels along for the local guard, which compares
// against it rather than logging in as the author again.
func (c *ctx) callCommentPeer(authSid, parentHost, entry string, params map[string]string) (any, error) {
	params[reqAppID] = c.appID()
	params[reqAppVer] = verLast
	params[reqSid] = authSid
	params["author"] = c.str("author")
	params[reqVersion] = c.version()
	if parentHost == c.nodeID() {
		return c.callEntry(entry, params)
	}
	return c.callRemote(parentHost, entry, params)
}

// userRootNode resolves the node that may delegate for a user: their own
// root. The parent author's node may hold no copy of a commenter's account
// (a user object does not follow the user's comments), and a node without a
// copy reports that as an MMOpen error rather than an empty record — either
// way, the account is pulled once, the way the recovery entries do.
func (c *ctx) userRootNode(userID string) (string, error) {
	user, loadErr := c.loadUser(userID)
	if loadErr == nil && user != nil && user.hasValidHost() {
		return user.hostID(), nil
	}
	authSid, err := c.authSid()
	if err != nil {
		return "", err
	}
	if err := c.mimeiSync(authSid, userID, nil); err != nil {
		c.warnf("load (%v) and sync for root of user %s failed: %v", loadErr, userID, err)
		return "", fmt.Errorf("User %s is not known here", userID)
	}
	user, err = c.loadUser(userID)
	if err != nil {
		return "", err
	}
	if user == nil || !user.hasValidHost() {
		return "", fmt.Errorf("User %s is not known here", userID)
	}
	return user.hostID(), nil
}

// entryApplyComment performs the parent-side half of add_comment on the parent
// author's root node: it creates the comment object, gives the parent both the
// list entry and the Mimei reference, and publishes. It is reached from
// add_comment on the writer's node and is not part of the client surface: the
// caller must be that node, named by the platform-injected node app code.
//
// A parent author's comment policy — who may comment at all — belongs here,
// where the node that owns the parent decides. There is no such setting yet.
func entryApplyComment(c *ctx) (any, error) {
	// What the peer call carried, for the cross-node record: presence only,
	// never the code itself.
	c.debugf("peer request: sid=%t nodeappcode=%t author=%q",
		c.sid() != "", c.str("nodeappcode") != "", c.str("author"))

	// tweetauthorid is the parent's author; userid is the older clients' name
	// for the same thing.
	tweetAuthorID := firstNonEmpty(c.str("tweetauthorid"), c.str("userid"))
	tweetID := c.str("tweetid")

	if tweetAuthorID == "" {
		return respErr(fmt.Errorf("Missing parent author ID: expected tweetauthorid")), nil
	}
	// A comment is stored on its parent's author's root node and referenced by
	// the parent, so this must be that node — the identity that decides it is
	// the parent's author, never the writer of the comment.
	if err := c.requireRootNode(tweetAuthorID); err != nil {
		return respErr(err), nil
	}
	// The parent object itself must agree: a request naming this root author
	// for a parent that belongs to someone else would attach the comment to a
	// copy of a foreign tweet.
	parent, err := c.loadTweet(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	if parent == nil {
		return respErr(fmt.Errorf("Tweet not found")), nil
	}
	if parent.authorID() != tweetAuthorID {
		return respErr(fmt.Errorf("Parent tweet does not belong to the named author")), nil
	}

	comment, err := c.obj("comment")
	if err != nil {
		return respErr(err), nil
	}
	commentAuthorID := tweetObj(comment).authorID()
	if commentAuthorID == "" {
		return respErr(fmt.Errorf("Missing comment author ID: expected comment.authorId")), nil
	}

	// The delegating node is the comment writer's own root, and only it may
	// ask this node to attach the comment.
	writerRoot, err := c.userRootNode(commentAuthorID)
	if err != nil {
		return respErr(err), nil
	}
	if err := c.requirePeerCall(writerRoot); err != nil {
		return respErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	commentID, err := c.fileObjectID(authSid, "tweet", "{{auto}}")
	if err != nil {
		return respErr(fmt.Errorf("MMCreate(comment): %v", err)), nil
	}
	comment["mid"] = commentID
	comment["timestamp"] = nowMillis()

	commentSid, err := c.openMimei(authSid, commentID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", commentID, err)), nil
	}
	defer c.closeMimei(commentSid)

	if err := c.setValue(commentSid, tweetContentKey, comment); err != nil {
		return respErr(err), nil
	}
	for _, attachment := range tweetObj(comment).attachments() {
		if mid := mapStr(attachment, "mid"); mid != "" {
			if err := c.addRef(authSid, commentID, mid); err != nil {
				c.warnf("attachment ref %s failed: %v", mid, err)
			}
		}
	}
	if err := c.backupDelRef(authSid, commentID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, commentID); err != nil {
		c.warnf("publish %s failed: %v", commentID, err)
	}

	// The parent gains both a list entry, for paging, and a reference, which is
	// what carries the comment when the parent is synchronised. Both are
	// required; neither replaces the other.
	tweetSid, err := c.openMimei(authSid, tweetID, verCur)
	if err != nil {
		return respErr(fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)), nil
	}
	defer c.closeMimei(tweetSid)

	if err := c.zadd(tweetSid, tweetCommentList, nowMillis(), commentID); err != nil {
		return respErr(err), nil
	}
	if err := c.addRef(authSid, tweetID, commentID); err != nil {
		return respErr(err), nil
	}
	if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.warnf("publish %s failed: %v", tweetID, err)
	}

	count, err := c.commentCount(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	return c.wrapPassthrough(map[string]any{
		"success":   true,
		"mid":       commentID,
		"commentId": commentID,
		"count":     count,
	}), nil
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

	readSid, err := c.openMimei("", tweetID, verLast)
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
	writeSid, err := c.openMimei(authSid, tweetID, verCur)
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
	if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
		return err
	}
	return c.mimeiPublish(authSid, tweetID)
}

// ---------------------------------------------------------------------------
// delete_comment
// ---------------------------------------------------------------------------

// entryDeleteComment removes a comment, called on the deleter's own root node.
//
// Both the comment's author and the parent's author may delete it, and nobody
// else. The authority check needs the comment object, which lives on the
// parent author's node, so it runs there: locally when this is that node,
// otherwise in remove_comment through the same guarded delegation add_comment
// uses. Dropping the comment from the deleter's saved lists happens here,
// where those lists live.
func entryDeleteComment(c *ctx) (any, error) {
	appUserID := c.str("appuserid")
	tweetID := c.str("tweetid")
	commentID := c.str("commentid")
	if appUserID == "" || tweetID == "" || commentID == "" {
		return respErr(fmt.Errorf("Missing parameters: expected appuserid, tweetid, commentid")), nil
	}
	// The deleter's session was issued by this node, the deleter's root.
	if err := c.requireRootNode(appUserID); err != nil {
		return respErr(err), nil
	}
	if err := c.requireOwner(appUserID); err != nil {
		return respErr(err), nil
	}

	parent, err := c.loadTweet(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	if parent == nil {
		return respErr(fmt.Errorf("Tweet not found")), nil
	}
	parentAuthorID := parent.authorID()
	if parentAuthorID == "" {
		return respErr(fmt.Errorf("Parent tweet has no author")), nil
	}

	// The comment lives on the parent author's node. Find it, preferring the
	// account's own record of its root over the client's hostid hint.
	parentHost := c.str("hostid")
	if parentAuthor, err := c.loadUser(parentAuthorID); err == nil && parentAuthor.hasValidHost() {
		parentHost = parentAuthor.hostID()
	}

	var reply any
	if parentHost == c.nodeID() {
		count, err := c.removeCommentChecked(tweetID, commentID, parentAuthorID, appUserID)
		if err != nil {
			return respErr(err), nil
		}
		reply = map[string]any{
			"success":   true,
			"commentId": commentID,
			"count":     count,
		}
	} else {
		if parentHost == "" {
			return respErr(fmt.Errorf("Parent author not found")), nil
		}
		authSid, err := c.authSid()
		if err != nil {
			return respErr(err), nil
		}
		reply, err = c.callCommentPeer(authSid, parentHost, "remove_comment", map[string]string{
			"tweetid":   tweetID,
			"commentid": commentID,
			"appuserid": appUserID,
		})
		if err != nil {
			return respErr(err), nil
		}
		if m, ok := toMap(reply); !ok || !mapBool(m, "success") {
			// The parent author's node decided against the deletion; its
			// refusal reaches the client unchanged.
			return c.wrapPassthrough(reply), nil
		}
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	if err := c.forgetSavedComment(authSid, appUserID, commentID); err != nil {
		c.errorf("Failed to remove comment from user lists %s: %v", appUserID, err)
	}
	return c.wrapPassthrough(reply), nil
}

// entryRemoveComment performs the parent-side half of delete_comment on the
// parent author's root node, with the same peer guard as apply_comment. The
// deleter is named by their own root node, which verified their session; the
// authority check against the comment object happens here, where it lives.
func entryRemoveComment(c *ctx) (any, error) {
	c.debugf("peer request: sid=%t nodeappcode=%t author=%q",
		c.sid() != "", c.str("nodeappcode") != "", c.str("author"))

	tweetID := c.str("tweetid")
	commentID := c.str("commentid")
	deleterID := c.str("appuserid")
	if deleterID == "" {
		return respErr(fmt.Errorf("Missing parameters: expected appuserid")), nil
	}

	parent, err := c.loadTweet(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	if parent == nil {
		return respErr(fmt.Errorf("Tweet not found")), nil
	}
	parentAuthorID := parent.authorID()
	if parentAuthorID == "" {
		return respErr(fmt.Errorf("Parent tweet has no author")), nil
	}
	if err := c.requireRootNode(parentAuthorID); err != nil {
		return respErr(err), nil
	}

	// Only the deleter's own root may ask this node to remove the comment.
	deleterRoot, err := c.userRootNode(deleterID)
	if err != nil {
		return respErr(err), nil
	}
	if err := c.requirePeerCall(deleterRoot); err != nil {
		return respErr(err), nil
	}

	count, err := c.removeCommentChecked(tweetID, commentID, parentAuthorID, deleterID)
	if err != nil {
		return respErr(err), nil
	}
	return c.wrapPassthrough(map[string]any{
		"success":   true,
		"commentId": commentID,
		"count":     count,
	}), nil
}

// removeCommentChecked performs a deletion on the node that holds the comment,
// after verifying the deleter is the comment's author or the parent's author.
// Each step is isolated because a partly deleted comment is worse than a fully
// deleted one: once the versions are gone, the list entry and reference must
// still go.
func (c *ctx) removeCommentChecked(tweetID, commentID, parentAuthorID, deleterID string) (int64, error) {
	comment, err := c.loadTweet(commentID)
	if err != nil {
		return 0, err
	}
	if comment != nil {
		if commentAuthor := comment.authorID(); commentAuthor != deleterID && parentAuthorID != deleterID {
			c.errorf("comment deletion refused %s", jsonStringify(map[string]any{
				"deleterId": deleterID, "commentAuthorId": commentAuthor,
				"parentAuthorId": parentAuthorID,
			}))
			return 0, fmt.Errorf("Only the comment's author or the parent's author may delete this comment")
		}
	} else if parentAuthorID != deleterID {
		// The comment is already gone. What remains is a list entry in the
		// parent author's data, so only the parent's author cleans it up.
		return 0, fmt.Errorf("Comment not found")
	}

	authSid, err := c.authSid()
	if err != nil {
		return 0, err
	}
	if err := c.destroyComment(authSid, commentID); err != nil {
		c.errorf("Failed to delete comment versions %s: %v", commentID, err)
	}
	if err := c.detachComment(authSid, tweetID, commentID); err != nil {
		c.errorf("Failed to remove comment from tweet %s: %v", tweetID, err)
	}

	count, err := c.commentCount(tweetID)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// destroyComment removes the comment object itself.
func (c *ctx) destroyComment(authSid, commentID string) error {
	return c.delVersions(authSid, commentID)
}

// detachComment removes the parent's reference and list entry, then republishes
// the parent so other nodes stop offering the comment.
func (c *ctx) detachComment(authSid, tweetID, commentID string) error {
	tweetSid, err := c.openMimei(authSid, tweetID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)
	}
	defer c.closeMimei(tweetSid)

	detachErr := c.delRef(authSid, tweetID, commentID)
	if err := c.zrem(tweetSid, tweetCommentList, commentID); err != nil && detachErr == nil {
		detachErr = err
	}

	// The parent is republished even if a removal failed: whatever did change
	// must become visible.
	if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
		c.errorf("Failed to backup/publish tweet %s: %v", tweetID, err)
	} else if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.errorf("Failed to backup/publish tweet %s: %v", tweetID, err)
	}
	return detachErr
}

// forgetSavedComment drops a deleted comment from the requesting user's saved
// lists, so it does not linger as a dangling bookmark or favorite.
func (c *ctx) forgetSavedComment(authSid, appUserID, commentID string) error {
	userSid, err := c.openMimei(authSid, appUserID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", appUserID, err)
	}
	defer c.closeMimei(userSid)

	if err := c.hdel(userSid, userBookmarkList, commentID); err != nil {
		return err
	}
	if err := c.hdel(userSid, userFavoriteList, commentID); err != nil {
		return err
	}
	return c.backupDelRef(authSid, appUserID, "")
}
