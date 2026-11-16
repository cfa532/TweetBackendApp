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

import (
	"fmt"
	"strings"
	"time"
)

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
	var retweet map[string]any
	if mapStr(comment, "originalTweetId") != "" && mapStr(comment, "originalAuthorId") != "" {
		originalHost := ""
		if mapStr(comment, "originalTweetId") == tweetID && mapStr(comment, "originalAuthorId") == parentAuthorID {
			originalHost = parentHost
		}
		retweet, err = c.createQuotedRetweet(originalHost)
		if err != nil {
			return respErr(err), nil
		}
		delete(comment, "originalTweetId")
		delete(comment, "originalAuthorId")
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	reply, err := c.callPeerEntry(authSid, parentHost, "apply_comment", map[string]string{
		"tweetid":       tweetID,
		"tweetauthorid": parentAuthorID,
		"comment":       jsonStringify(comment),
		"requestid":     c.str("requestid"),
	})
	if err != nil {
		return respErr(err), nil
	}
	if retweetID := mapStr(retweet, "mid"); retweetID != "" {
		if m, ok := toMap(reply); ok {
			m["retweetid"] = retweetID
			if count, ok := retweet["originalRetweetCount"]; ok {
				m["originalRetweetCount"] = count
			}
		}
	}
	// A peer failure arrives as an envelope of its own and must reach the
	// client unchanged rather than being re-labelled a local success.
	return c.wrapPassthrough(reply), nil
}

// createQuotedRetweet creates the retweet half of a quote-comment and returns
// its creation result. The retweet belongs to the writer of the comment, and add_comment now
// runs on the writer's root node, so the tweet is created right here through
// add_tweet, which checks the writer's session itself. A requestid from the
// comment submission names the quote half deterministically ("-quote"), so a
// retried quote-comment converges on the same two objects.
//
// Best effort, as it has always been: a comment whose quoted retweet could not
// be created is still a comment, and the caller reports an empty retweet id.
func (c *ctx) createQuotedRetweet(originalHost string) (map[string]any, error) {
	params := map[string]string{
		reqAppID:               c.appID(),
		reqAppVer:              verLast,
		"tweet":                c.str("comment"),
		"originalauthorhostid": originalHost,
	}
	if requestID := c.str("requestid"); requestID != "" {
		params["requestid"] = requestID + "-quote"
	}
	ret, err := c.callEntryMap("add_tweet", params)
	if err != nil {
		c.warnf("quoted tweet creation failed: %v", err)
		return nil, nil
	}
	if !mapBool(ret, "success") {
		if mapStr(ret, "message") == submissionConflict {
			return nil, fmt.Errorf("%s", submissionConflict)
		}
		c.warnf("quoted tweet creation failed: %s", jsonStringify(ret))
		return nil, nil
	}
	return ret, nil
}

// callPeerEntry reaches a guarded peer entry on another party's node:
// directly when this is that node, otherwise through a cross-node call.
//
// The author session in sid survives only the local callEntry; a cross-node
// RunMApp deletes sid before the request leaves this node, and the target
// identifies its caller by the nodeappcode the platform injects there. The
// node-set author uid travels along for the local guard, which compares
// against it rather than logging in as the author again.
func (c *ctx) callPeerEntry(authSid, parentHost, entry string, params map[string]string) (any, error) {
	params[reqAppID] = c.appID()
	params[reqAppVer] = verLast
	params[reqSid] = authSid
	params["author"] = c.str("author")
	params[reqVersion] = c.version()
	if parentHost != c.nodeID() {
		return c.callRemote(parentHost, entry, params)
	}
	if !c.background {
		return c.callEntry(entry, params)
	}
	// A background job has left the caller's app lock. Even a same-node
	// peer mutation must go through Leither's normal app dispatch.
	reply, err := c.callRemote(parentHost, entry, params)
	for attempt := 0; attempt < 3; attempt++ {
		message := ""
		if err != nil {
			message = err.Error()
		} else if response, ok := toMap(reply); ok && !mapBool(response, "success") {
			message = firstNonEmpty(mapStr(response, "message"), mapStr(response, "error"))
		}
		if !strings.Contains(message, "app busy") {
			break
		}
		time.Sleep(time.Duration(attempt+1) * 100 * time.Millisecond)
		reply, err = c.callRemote(parentHost, entry, params)
	}
	return reply, err
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
	if err := c.mimeiSync(authSid, userID, ""); err != nil {
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
	if err := c.requirePeerCall(commentAuthorID); err != nil {
		return respErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	// The comment writer's node names this submission with a requestid; the
	// id is derived from the mark, so a retried comment resolves the same
	// object. Without one a fresh id is minted, as before.
	requestID := c.str("requestid")
	commentID, err := c.fileObjectID(authSid, "tweet", submissionMark("comment", commentAuthorID, requestID))
	if err != nil {
		return respErr(fmt.Errorf("MMCreate(comment): %v", err)), nil
	}
	comment["parentTweetId"] = tweetID
	commentCommitted, err := c.commitSubmission(authSid, commentID, requestID, tweetObj(comment), false)
	if err != nil {
		return respErr(err), nil
	}

	parentLists := false
	if commentCommitted {
		if parentLists, err = c.listedInCommitted(tweetID, tweetCommentList, commentID); err != nil {
			return respErr(err), nil
		}
	}
	var count int64
	if parentLists {
		err = c.readMimei(authSid, tweetID, func(mmsid string) error {
			var readErr error
			count, readErr = c.zcard(mmsid, tweetCommentList)
			return readErr
		})
	} else {
		count, err = c.linkSubmittedComment(authSid, tweetID, commentID, tweetObj(comment).timestamp())
	}
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

// linkSubmittedComment gives the parent both the paginated list entry and
// the native reference that carries the comment when the parent synchronizes.
func (c *ctx) linkSubmittedComment(authSid, tweetID, commentID string, score int64) (int64, error) {
	tweetSid, err := c.openMimei(authSid, tweetID, verCur)
	if err != nil {
		return 0, fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)
	}
	defer c.closeMimei(tweetSid)

	if err := c.zadd(tweetSid, tweetCommentList, score, commentID); err != nil {
		return 0, err
	}
	if err := c.addRef(authSid, tweetID, commentID); err != nil {
		return 0, err
	}
	count, err := c.zcard(tweetSid, tweetCommentList)
	if err != nil {
		return 0, err
	}
	if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
		return 0, err
	}
	if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.warnf("publish %s failed: %v", tweetID, err)
	}
	return count, nil
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

	authorID := tweetObj(parent).authorID()
	isHome := authorID != "" && c.isHomeNode(authorID)

	pairs, err := c.zrevrange(readSid, tweetCommentList, startRank, endRank)
	if err != nil {
		return c.wrapErrList(err), nil
	}

	// One slot per scanned entry, always: dropping an unresolved comment would
	// shorten the page and make the client conclude the thread had ended.
	comments := make([]any, 0, len(pairs))
	for _, pair := range pairs {
		commentID := pair.Member
		if comment := c.fetchTweetV2(commentID, appUserID); comment != nil {
			comments = append(comments, comment)
		} else if isHome {
			comments = append(comments, nil)
		} else {
			comments = append(comments, map[string]any{"mid": commentID})
		}
	}
	return c.wrap(comments), nil
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
		// The hint alone may have named this node; the deletion happens only
		// where the parent's author is actually rooted.
		if err := c.requireRootNode(parentAuthorID); err != nil {
			return respErr(err), nil
		}
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
		reply, err = c.callPeerEntry(authSid, parentHost, "remove_comment", map[string]string{
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
	if err := c.requirePeerCall(deleterID); err != nil {
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
// Keep the membership until the comment object has been removed.
func (c *ctx) removeCommentChecked(tweetID, commentID, parentAuthorID, deleterID string) (int64, error) {
	// The object must be one of this parent's comments. Being the parent's
	// author is authority over that parent's thread and nothing else: without
	// this, the author of any tweet here could name another object on the node
	// as a "comment" of theirs and have it destroyed.
	listed, err := c.listedInCommitted(tweetID, tweetCommentList, commentID)
	if err != nil {
		return 0, err
	}
	if !listed {
		return 0, fmt.Errorf("Comment not found")
	}

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
	tweetSid, err := c.openMimei(authSid, tweetID, verCur)
	if err != nil {
		return 0, fmt.Errorf("MMOpen(%s, cur): %v", tweetID, err)
	}
	defer c.closeMimei(tweetSid)

	// Prepare the count before destroying the comment. Use the writable list
	// so a retry after a partial removal does not subtract the entry twice.
	pairs, err := c.zrevrange(tweetSid, tweetCommentList, 0, -1)
	if err != nil {
		return 0, err
	}
	count := int64(len(pairs))
	for _, pair := range pairs {
		if pair.Member == commentID {
			count--
			break
		}
	}

	// Retain the parent's membership if removing the object itself fails.
	if comment != nil {
		if err := c.delVersions(authSid, commentID); err != nil {
			return 0, err
		}
	}
	if err := c.delRef(authSid, tweetID, commentID); err != nil {
		return 0, err
	}
	if err := c.zrem(tweetSid, tweetCommentList, commentID); err != nil {
		return 0, err
	}
	if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
		return 0, err
	}
	if err := c.mimeiPublish(authSid, tweetID); err != nil {
		c.warnf("publish %s failed: %v", tweetID, err)
	}
	return count, nil
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
