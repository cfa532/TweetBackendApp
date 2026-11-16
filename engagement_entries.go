// engagement_entries.go — bookmarks and favorites.
//
// Both are two-sided: the tweet records who engaged with it, and the user
// records what they engaged with. The two halves live on different nodes — the
// tweet's list on the author's node, the user's list on the user's node — so a
// single toggle is two writes on two machines.
//
// Since caller identity, the engaging user calls toggle_favorite or
// toggle_bookmark on their OWN root node, signed by their session. That node
// verifies them and commits the user's own list. It then asks the tweet
// author's node to update its record through a guarded peer entry. The peer
// update is best effort. The peer pairs are:
//
//	toggle_bookmark  -> apply_bookmark on the tweet author's node
//	toggle_favorite  -> apply_favorite on the tweet author's node
//
// The peer entry admits only the engaging user's own root node (the node app
// code the platform injects names it), re-derives the tweet's author from the
// tweet object itself, and then writes the author's list.
//
// Bookmarks and favorites differ only in which keys they use, which parameter
// carries the desired state, and which slot of the tweet's "favorites" triple
// reports it — so both run through one implementation described by engagementKind.
package lapp

import "fmt"

// engagementKind describes one of the two engagement types.
type engagementKind struct {
	// entry is the client entry on the engaging user's node; peerEntry is the
	// guarded peer entry on the tweet author's node.
	entry     string
	peerEntry string
	// tweetKey is the list inside the tweet; userKey the list inside the user.
	tweetKey string
	userKey  string
	// stateParam names the request parameter carrying the desired state.
	stateParam string
	// userParam names the request parameter carrying the acting user's id.
	userParam      string
	userCountField string
}

// bookmarkKind and favoriteKind are functions, not package-level variables:
// the node's interpreter does not run package-level initialisers, so a var
// would be the zero value at runtime — every key name empty, which would write
// engagement data under blank keys rather than fail visibly.
func bookmarkKind() engagementKind {
	return engagementKind{
		entry:          "toggle_bookmark",
		peerEntry:      "apply_bookmark",
		tweetKey:       tweetBookmarkList,
		userKey:        userBookmarkList,
		stateParam:     "isbookmarked",
		userParam:      "userid",
		userCountField: "bookmarksCount",
	}
}

func favoriteKind() engagementKind {
	return engagementKind{
		entry:          "toggle_favorite",
		peerEntry:      "apply_favorite",
		tweetKey:       tweetLikeList,
		userKey:        userFavoriteList,
		stateParam:     "isfavorite",
		userParam:      "appuserid",
		userCountField: "favoritesCount",
	}
}

func entryToggleBookmark(c *ctx) (any, error) { return c.toggleEngagement(bookmarkKind()) }
func entryToggleFavorite(c *ctx) (any, error) { return c.toggleEngagement(favoriteKind()) }

func entryApplyBookmark(c *ctx) (any, error) { return c.applyEngagementPeer(bookmarkKind()) }
func entryApplyFavorite(c *ctx) (any, error) { return c.applyEngagementPeer(favoriteKind()) }

// ---------------------------------------------------------------------------
// Client entry: the engaging user's own node
// ---------------------------------------------------------------------------

// toggleEngagement records a save on both sides, called by the engaging user
// on their own root node.
//
// The desired state may be stated explicitly, which makes the operation
// idempotent and lets a client retry safely. When it is omitted the user's own
// list is flipped; with no stated state that list is the one record the user's
// node owns outright, so it decides.
//
// The user's saved list determines the result. A save without a known tweet
// author requires an explicit state and a verified account owner.
func (c *ctx) toggleEngagement(kind engagementKind) (any, error) {
	startedAt := nowMillis()
	userID := c.str(kind.userParam)
	tweetID := c.str("tweetid")
	authorID := c.str("authorid")

	// The user's own list is written here, so this must be their root node —
	// and the session must be the user's own.
	if err := c.requireRootNode(userID); err != nil {
		return c.wrapErrString(fmt.Errorf("User host not found")), nil
	}

	if tweetID == "" {
		return c.wrapErrString(fmt.Errorf("Missing tweet ID")), nil
	}
	requested, stateGiven := c.requestedState(kind.stateParam)
	if authorID == "" {
		if !stateGiven {
			return c.wrapErrString(fmt.Errorf("A save without an author requires an explicit state")), nil
		}
		owner, err := c.loadUser(userID)
		if err != nil {
			return c.wrapErrString(err), nil
		}
		if err := c.requireBoundOwner(owner, userID); err != nil {
			return c.wrapErrString(err), nil
		}
	} else if err := c.requireOwner(userID); err != nil {
		return c.wrapErrString(err), nil
	}

	wanted := requested
	if !stateGiven {
		was, err := c.savedTweetState(kind, userID, tweetID)
		if err != nil {
			return c.wrapErrString(err), nil
		}
		wanted = !was
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrString(err), nil
	}
	updatedUser, committed, err := c.applyEngagementToUser(kind, authSid, userID, tweetID, wanted)
	if err != nil {
		return c.wrapErrString(err), nil
	}

	c.infof("saved list confirmed userId=%s tweetId=%s saved=%t elapsedMs=%d",
		userID, tweetID, wanted, nowMillis()-startedAt)

	authorHost := c.str("hostid")
	c.afterCommit(func(work *ctx) {
		if committed {
			work.publishCommitted(authSid, userID)
		}
		if authorID != "" {
			work.deliverSavedState(kind, authSid, userID, tweetID, authorID, authorHost)
		}
		if wanted {
			work.ensureProvided(authSid, tweetID)
		}
	})

	return c.wrapPassthrough(map[string]any{
		"success": true,
		"user":    updatedUser,
		"tweet":   nil,
		"saved":   wanted,
	}), nil
}

// Deliver the committed state. If another save finishes while our peer call
// is in flight, re-send the newer state so a slow earlier call cannot win.
func (c *ctx) deliverSavedState(kind engagementKind, authSid, userID, tweetID, authorID, authorHost string) {
	wanted, err := c.savedTweetState(kind, userID, tweetID)
	for err == nil {
		if err = c.updateEngagementPeer(kind, authSid, userID, tweetID, authorID, authorHost, wanted); err != nil {
			break
		}
		c.infof("tweet-side update confirmed userId=%s tweetId=%s saved=%t", userID, tweetID, wanted)
		next, readErr := c.savedTweetState(kind, userID, tweetID)
		if readErr == nil && next == wanted {
			return
		}
		wanted, err = next, readErr
	}
	c.warnf("tweet-side update failed after local commit userId=%s tweetId=%s: %v", userID, tweetID, err)
}

func (c *ctx) updateEngagementPeer(kind engagementKind, authSid, userID, tweetID, authorID, authorHost string, wanted bool) error {
	// A caller that knows the root can spare this node a profile read.
	// The peer independently verifies the tweet's storage author and root.
	if authorHost == "" {
		var err error
		authorHost, err = c.userHostID(authorID)
		if err != nil {
			return fmt.Errorf("resolve root for tweet storage author %s: %w", authorID, err)
		}
	}
	if authorHost == "" {
		return fmt.Errorf("root not found for tweet storage author %s", authorID)
	}
	peerReply, err := c.callPeerEntry(authSid, authorHost, kind.peerEntry, map[string]string{
		"tweetid":  tweetID,
		"authorid": authorID,
		"userid":   userID,
		"wanted":   boolParam(wanted),
	})
	if err != nil {
		return err
	}
	peer, _ := toMap(peerReply)
	if !mapBool(peer, "success") {
		message := firstNonEmpty(mapStr(peer, "message"), mapStr(peer, "error"), "The tweet's node did not confirm the update")
		return fmt.Errorf("%s", message)
	}
	return nil
}

// viewerSavedFlags reads both personal flags from the viewer's committed
// account copy. A tweet replica can carry older tweet-side membership.
func (c *ctx) viewerSavedFlags(userID, tweetID string) (favorite, bookmark, atRoot, known bool) {
	if userID == "" || userID == "000000000000000000000000000" {
		return false, false, false, false
	}
	err := c.readMimei("", userID, func(mmsid string) error {
		account, err := c.getObject(mmsid, ownerDataKey)
		if err != nil {
			return err
		}
		if account == nil {
			return fmt.Errorf("viewer account unavailable")
		}
		root := userObj(account).hostID()
		atRoot = root != "" && root == c.nodeID()
		favorite, err = c.hhas(mmsid, userFavoriteList, tweetID)
		if err != nil {
			return err
		}
		bookmark, err = c.hhas(mmsid, userBookmarkList, tweetID)
		return err
	})
	return favorite, bookmark, atRoot && err == nil, err == nil
}

// savedTweetState reads whether a tweet is in the user's own save list.
func (c *ctx) savedTweetState(kind engagementKind, userID, tweetID string) (bool, error) {
	var saved bool
	err := c.readMimei("", userID, func(mmsid string) error {
		has, err := c.hhas(mmsid, kind.userKey, tweetID)
		saved = has
		return err
	})
	return saved, err
}

// ---------------------------------------------------------------------------
// Peer entry: the tweet author's node
// ---------------------------------------------------------------------------

// applyEngagementPeer performs the tweet-side half of a save on the object's
// storage root. Only the engaging user's own node can request the write.
func (c *ctx) applyEngagementPeer(kind engagementKind) (any, error) {
	c.debugf("peer request: sid=%t nodeappcode=%t author=%q",
		c.sid() != "", c.str("nodeappcode") != "", c.str("author"))

	userID := c.str("userid")
	tweetID := c.str("tweetid")
	authorID := c.str("authorid")
	wanted := c.boolParam("wanted")

	if err := c.requirePeerCall(userID); err != nil {
		return respErr(err), nil
	}
	if err := c.requireRootNode(authorID); err != nil {
		return respErr(fmt.Errorf("Author host not found")), nil
	}
	tweet, err := c.loadTweet(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	if tweet == nil {
		return respErr(fmt.Errorf("Tweet not found")), nil
	}

	if err := c.requireTweetStorageAuthor(tweet, tweetID, authorID); err != nil {
		return respErr(err), nil
	}

	updatedTweet := c.applyEngagementToTweet(kind, userID, authorID, tweetID, wanted, true)
	if updatedTweet == nil {
		return respErr(fmt.Errorf("Failed to read tweet %s after updating it", tweetID)), nil
	}
	c.infof("tweet-side record confirmed userId=%s tweetId=%s saved=%t", userID, tweetID, wanted)
	return c.wrapPassthrough(map[string]any{
		"success": true,
		"tweet":   updatedTweet,
	}), nil
}

// tweetStorageAuthor identifies the root owner from committed references.
// A standalone quote may carry a parent ID and still belong to its own author.
func (c *ctx) tweetStorageAuthor(tweet tweetObj, tweetID, expectedAuthorID string) (string, error) {
	authorID := tweet.authorID()
	parentID := mapStr(tweet, "parentTweetId")
	if parentID == "" {
		return authorID, nil
	}
	if tweet.originalTweetID() != "" && (expectedAuthorID == "" || expectedAuthorID == authorID) {
		listed, err := c.listedInCommitted(authorID, userTweetList, tweetID)
		if err != nil {
			return "", err
		}
		if listed {
			return authorID, nil
		}
	}
	parent, err := c.loadTweet(parentID)
	if err != nil {
		return "", err
	}
	if parent == nil || parent.authorID() == "" {
		return "", fmt.Errorf("Parent tweet not found")
	}
	listed, err := c.listedInCommitted(parentID, tweetCommentList, tweetID)
	if err != nil {
		return "", err
	}
	if !listed {
		return "", fmt.Errorf("Comment not found in its parent")
	}
	return parent.authorID(), nil
}

func (c *ctx) requireTweetStorageAuthor(tweet tweetObj, tweetID, authorID string) error {
	ownerID, err := c.tweetStorageAuthor(tweet, tweetID, authorID)
	if err != nil {
		return err
	}
	if ownerID != authorID {
		return fmt.Errorf("Tweet does not belong to the named author")
	}
	return nil
}

// applyEngagementToTweet flips or sets the tweet's record of this user, and
// returns the tweet as it now stands.
//
// Failures are logged and return a nil tweet to the peer caller.
func (c *ctx) applyEngagementToTweet(kind engagementKind, userID, authorID, tweetID string, requested, stateGiven bool) any {
	authSid, err := c.authSid()
	if err != nil {
		c.errorf("Error toggle %s of tweet: %v, request=%s", kind.tweetKey, err, c.requestJSON())
		return nil
	}
	tweetSid, err := c.openMimei(authSid, tweetID, verCur)
	if err != nil {
		c.errorf("Error toggle %s of tweet: %v, request=%s", kind.tweetKey, err, c.requestJSON())
		return nil
	}
	defer c.closeMimei(tweetSid)

	was, err := c.hhas(tweetSid, kind.tweetKey, userID)
	if err != nil {
		c.errorf("Error toggle %s of tweet: %v, request=%s", kind.tweetKey, err, c.requestJSON())
		return nil
	}
	now := was
	if stateGiven {
		now = requested
	} else {
		now = !was
	}

	if now != was {
		if now {
			err = c.hset(tweetSid, kind.tweetKey, userID, nowMillis())
		} else {
			err = c.hdel(tweetSid, kind.tweetKey, userID)
		}
		if err != nil {
			c.errorf("Error toggle %s of tweet: %v, request=%s", kind.tweetKey, err, c.requestJSON())
			return nil
		}
		if err := c.backupDelRef(authSid, tweetID, ""); err != nil {
			c.errorf("Error toggle %s of tweet: %v, request=%s", kind.tweetKey, err, c.requestJSON())
			return nil
		}
		if err := c.mimeiPublish(authSid, tweetID); err != nil {
			c.warnf("publish %s failed: %v", tweetID, err)
		}
	}
	return c.fetchTweetV2(tweetID, userID)
}

// ---------------------------------------------------------------------------
// User side
// ---------------------------------------------------------------------------

// applyEngagementToUser records or clears a tweet in the user's own list.
func (c *ctx) applyEngagementToUser(kind engagementKind, authSid, userID, tweetID string, wanted bool) (any, bool, error) {
	userSid, err := c.openMimei(authSid, userID, verCur)
	if err != nil {
		return nil, false, fmt.Errorf("MMOpen(%s, cur): %v", userID, err)
	}
	defer c.closeMimei(userSid)

	was, err := c.hhas(userSid, kind.userKey, tweetID)
	if err != nil {
		return nil, false, err
	}
	// Prepare the user payload before writing so the commit is the last
	// required storage step.
	updatedUser, err := c.userCoreData(userSid, userID)
	if err != nil {
		return nil, false, err
	}
	if updatedUser == nil {
		return nil, false, fmt.Errorf("User not found")
	}

	if wanted == was {
		// A failed backup can leave matching data in the writable version.
		// Acknowledge a no-op only if the committed list already matches.
		committed, err := c.savedTweetState(kind, userID, tweetID)
		if err != nil {
			return nil, false, err
		}
		if committed == wanted {
			return updatedUser, false, nil
		}
	} else {
		count := mapInt(updatedUser, kind.userCountField, 0)
		if wanted {
			err = c.hset(userSid, kind.userKey, tweetID, nowMillis())
			count++
		} else {
			err = c.hdel(userSid, kind.userKey, tweetID)
			count--
		}
		if err != nil {
			return nil, false, err
		}
		updatedUser[kind.userCountField] = count
	}

	if err := c.backupDelRef(authSid, userID, ""); err != nil {
		return nil, false, err
	}
	return updatedUser, true, nil
}

// requestedState reads an optional desired-state parameter, reporting both the
// value and whether it was supplied at all. An omitted parameter means "flip
// whatever it is now".
func (c *ctx) requestedState(name string) (state bool, given bool) {
	if !c.present(name) {
		return false, false
	}
	raw := c.str(name)
	if raw == "" {
		return false, false
	}
	return raw == "true", true
}

// boolParam renders a boolean for a request parameter.
func boolParam(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

// wrapErrString reports an engagement failure. Legacy callers read the message
// under "error".
func (c *ctx) wrapErrString(err error) any {
	c.failf(err)
	if c.isV2() {
		out := respErr(err)
		out["error"] = err.Error()
		return out
	}
	return map[string]any{"success": false, "error": err.Error()}
}
