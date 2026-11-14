// engagement_entries.go — bookmarks and favorites.
//
// Both are two-sided: the tweet records who engaged with it, and the user
// records what they engaged with. The two halves live on different nodes — the
// tweet's list on the author's node, the user's list on the user's node — so a
// single toggle is two writes on two machines.
//
// Since caller identity, the engaging user calls toggle_favorite or
// toggle_bookmark on their OWN root node, signed by their session. That node
// verifies them, asks the tweet author's node to perform the tweet-side write
// through a guarded peer entry, and then records the save in the user's own
// list — delegation first, so a refused or unreachable peer leaves nothing
// half-written. The peer pairs are:
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
	userParam string
	// favoritesIndex is this kind's slot in the get_tweet "favorites" triple,
	// which is ordered [isFavorite, isBookmarked, hasRetweeted].
	favoritesIndex int
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
		favoritesIndex: 1,
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
		favoritesIndex: 0,
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
// The tweet-side write is delegated before anything is written locally, so a
// refused or unreachable author node leaves the user's list untouched rather
// than half of a save behind.
func (c *ctx) toggleEngagement(kind engagementKind) (any, error) {
	userID := c.str(kind.userParam)
	tweetID := c.str("tweetid")
	authorID := c.str("authorid")

	// The user's own list is written here, so this must be their root node —
	// and the session must be the user's own.
	if err := c.requireRootNode(userID); err != nil {
		return c.wrapErrString(fmt.Errorf("User host not found")), nil
	}
	if err := c.requireOwner(userID); err != nil {
		return c.wrapErrString(err), nil
	}

	// What state should the save end in? With no stated state, the user's own
	// list decides, read-only for now: nothing is written until the tweet's
	// author has performed their half.
	requested, stateGiven := c.requestedState(kind.stateParam)
	wanted := requested
	if !stateGiven {
		was, err := c.savedTweetState(kind, userID, tweetID)
		if err != nil {
			return c.wrapErrString(err), nil
		}
		wanted = !was
	}

	// Route to the tweet author's node, preferring this node's own record of
	// their account over the client's hostid hint. The target re-checks
	// everything, so a wrong hint can only fail, never misroute a write.
	authorHost := c.str("hostid")
	if author, err := c.loadUser(authorID); err == nil && author != nil && author.hasValidHost() {
		authorHost = author.hostID()
	}
	if authorHost == "" {
		return c.wrapErrString(fmt.Errorf("Author host not found")), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrString(err), nil
	}
	peerReply, err := c.callPeerEntry(authSid, authorHost, kind.peerEntry, map[string]string{
		"tweetid":  tweetID,
		"authorid": authorID,
		"userid":   userID,
		"wanted":   boolParam(wanted),
	})
	if err != nil {
		return c.wrapErrString(err), nil
	}
	peer, ok := toMap(peerReply)
	if !ok || !mapBool(peer, "success") {
		message := firstNonEmpty(mapStr(peer, "message"), mapStr(peer, "error"))
		if message == "" {
			message = "Failed to update the tweet's record of this save"
		}
		return c.wrapErrString(fmt.Errorf("%s", message)), nil
	}

	// The author's node has performed its half; record the save in the user's
	// own list (a no-op when the states already agree).
	updatedUser, err := c.applyEngagementToUser(kind, userID, tweetID, wanted)
	if err != nil {
		c.failf(err)
		return c.wrapErrString(err), nil
	}
	if updatedUser == nil {
		return c.wrapErrString(fmt.Errorf("Failed to update user's saved items")), nil
	}

	c.debugf("engagement %s: userId=%s, tweetId=%s, wanted=%t", kind.entry, userID, tweetID, wanted)
	return c.wrapPassthrough(map[string]any{
		"success": true,
		"user":    updatedUser,
		"tweet":   peer["tweet"],
	}), nil
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

// applyEngagementPeer performs the tweet-side half of a save on the tweet
// author's root node. It is reached from toggle_favorite and toggle_bookmark
// on the engaging user's node and is not part of the client surface: the
// caller must be that node, named by the platform-injected node app code, and
// the tweet must belong to the author the request names.
func (c *ctx) applyEngagementPeer(kind engagementKind) (any, error) {
	c.debugf("peer request: sid=%t nodeappcode=%t author=%q",
		c.sid() != "", c.str("nodeappcode") != "", c.str("author"))

	userID := c.str("userid")
	tweetID := c.str("tweetid")
	authorID := c.str("authorid")
	wanted := c.boolParam("wanted")

	// The tweet's list lives on its author's root node, so this must be that
	// node.
	if err := c.requireRootNode(authorID); err != nil {
		return respErr(fmt.Errorf("Author host not found")), nil
	}
	// The tweet object itself must agree: a request naming this root author
	// for a tweet that belongs to someone else would write a foreign tweet's
	// list.
	tweet, err := c.loadTweet(tweetID)
	if err != nil {
		return respErr(err), nil
	}
	if tweet == nil {
		return respErr(fmt.Errorf("Tweet not found")), nil
	}
	if tweet.authorID() != authorID {
		return respErr(fmt.Errorf("Tweet does not belong to the named author")), nil
	}

	// Only the engaging user's own root may ask this node to record the save.
	if err := c.requirePeerCall(userID); err != nil {
		return respErr(err), nil
	}

	updatedTweet := c.applyEngagementToTweet(kind, userID, authorID, tweetID, wanted, true)
	if updatedTweet == nil {
		// Without the tweet's own record there is nothing to mirror, and the
		// caller must not record a save the tweet never received.
		return respErr(fmt.Errorf("Failed to read tweet %s after updating it", tweetID)), nil
	}
	return c.wrapPassthrough(map[string]any{
		"success": true,
		"tweet":   updatedTweet,
	}), nil
}

// applyEngagementToTweet flips or sets the tweet's record of this user, and
// returns the tweet as it now stands.
//
// Every failure inside is logged and yields a nil tweet, so the individual steps
// stay self-contained; the caller decides what an absent tweet means, and it
// abandons the toggle rather than mirroring a state it never read.
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
//
// Saving also registers the user's node as a provider; Leither synchronizes
// the tweet so it stays readable if its author's node goes away. Removing does
// not reverse that: the copy may be the only one left, and other users' saves
// may depend on it.
func (c *ctx) applyEngagementToUser(kind engagementKind, userID, tweetID string, wanted bool) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return nil, err
	}
	// The list written here is the user's own, so this must be their root
	// node.
	if err := c.requireRootNode(userID); err != nil {
		return nil, err
	}

	userSid, err := c.openMimei(authSid, userID, verCur)
	if err != nil {
		return nil, fmt.Errorf("MMOpen(%s, cur): %v", userID, err)
	}
	defer c.closeMimei(userSid)

	was, err := c.hhas(userSid, kind.userKey, tweetID)
	if err != nil {
		return nil, err
	}
	changed := wanted != was

	if changed {
		if wanted {
			// The value is the save time, which the saved-item listing uses to
			// order the list and to age out entries that never resolve.
			err = c.hset(userSid, kind.userKey, tweetID, nowMillis())
		} else {
			err = c.hdel(userSid, kind.userKey, tweetID)
		}
		if err != nil {
			c.errorf("Failed to update %s list: %v, userId=%s, tweetId=%s", kind.userKey, err, userID, tweetID)
			return nil, err
		}
		if err := c.backupDelRef(authSid, userID, ""); err != nil {
			c.errorf("Failed to update %s list: %v, userId=%s, tweetId=%s", kind.userKey, err, userID, tweetID)
			return nil, err
		}
		if err := c.mimeiPublish(authSid, userID); err != nil {
			c.errorf("Failed to publish user %s: %v", userID, err)
		}
	}

	if wanted {
		// Provider status, rather than the list or the author's location,
		// decides whether this node needs to register the saved tweet.
		c.ensureProvided(authSid, tweetID)
	}
	// Un-saving deliberately does not unprovide or delete the local copy: this
	// node may hold the only reachable copy of the tweet.

	updatedUser, err := c.callEntry("get_user_core_data", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
	})
	if err != nil {
		return nil, err
	}
	c.debugf("local tweetId=%s, userData=%s", tweetID, jsonStringify(updatedUser))
	return c.wrapNotNull(updatedUser, "User not found"), nil
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
