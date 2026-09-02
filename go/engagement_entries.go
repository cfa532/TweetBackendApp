// engagement_entries.go — bookmarks and favorites.
//
// Both are two-sided: the tweet records who engaged with it, and the user
// records what they engaged with. The two halves live on different nodes — the
// tweet's list on the author's node, the user's list on the user's node — so a
// single toggle is two writes on two machines.
//
// The tweet side is written first and its resulting state drives the user side,
// so the two cannot disagree about whether the toggle actually flipped. The
// entry pairs are:
//
//	toggle_bookmark  -> tweet side, then calls toggle_bookmark_by_user
//	toggle_favorite  -> tweet side, then calls toggle_favorite_by_user
//
// Bookmarks and favorites differ only in which keys they use, which parameter
// carries the desired state, and which slot of the tweet's "favorites" triple
// reports it — so both run through one implementation described by engagementKind.
package lapp

import "fmt"

// engagementKind describes one of the two engagement types.
type engagementKind struct {
	// entry and byUserEntry are the two entry names involved.
	entry       string
	byUserEntry string
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
		byUserEntry:    "toggle_bookmark_by_user",
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
		byUserEntry:    "toggle_favorite_by_user",
		tweetKey:       tweetLikeList,
		userKey:        userFavoriteList,
		stateParam:     "isfavorite",
		userParam:      "appuserid",
		favoritesIndex: 0,
	}
}

func entryToggleBookmark(c *ctx) (any, error) { return c.toggleEngagement(bookmarkKind()) }
func entryToggleFavorite(c *ctx) (any, error) { return c.toggleEngagement(favoriteKind()) }

func entryToggleBookmarkByUser(c *ctx) (any, error) { return c.toggleEngagementByUser(bookmarkKind()) }
func entryToggleFavoriteByUser(c *ctx) (any, error) { return c.toggleEngagementByUser(favoriteKind()) }

// ---------------------------------------------------------------------------
// Tweet side
// ---------------------------------------------------------------------------

// toggleEngagement updates the tweet's side of an engagement and then the
// user's side.
//
// The desired state may be stated explicitly, which makes the operation
// idempotent and lets a client retry safely. When it is omitted the current
// state is flipped, which is what older clients rely on.
func (c *ctx) toggleEngagement(kind engagementKind) (any, error) {
	userID := c.str(kind.userParam)
	tweetID := c.str("tweetid")
	authorID := c.str("authorid")
	userHostID := c.str("userhostid")

	requested, stateGiven := c.requestedState(kind.stateParam)

	// The tweet lives on its author's root node, so this must be that node.
	if err := c.requireRootNode(authorID); err != nil {
		return c.wrapErrString(fmt.Errorf("Author host not found")), nil
	}
	systemSid, err := c.nodeDataSid(verCur)
	if err != nil {
		return c.wrapErrString(err), nil
	}

	updatedTweet := c.applyEngagementToTweet(kind, userID, authorID, tweetID, requested, stateGiven)
	if updatedTweet == nil {
		// The user's half is mirrored from the tweet's own record below. Without
		// that record there is nothing to mirror, and reading the missing flag as
		// false would tell the user's node to drop a save the user still has.
		// The JavaScript entry failed here too, by dereferencing the absent
		// tweet.
		return c.wrapErrString(fmt.Errorf("Failed to read tweet %s after updating it", tweetID)), nil
	}

	// The user's own list is updated from the state the tweet ended up in, not
	// from what was requested, so a no-op toggle stays a no-op on both sides.
	//
	// skipcontentsync is set when the user lives on this node: the tweet is
	// already here, so pulling it again would be wasted work.
	byUserParams := map[string]string{
		reqAppID:          c.appID(),
		reqAppVer:         verLast,
		reqSid:            systemSid,
		"userid":          userID,
		"tweetid":         tweetID,
		kind.stateParam:   boolParam(engagementFlag(updatedTweet, kind.favoritesIndex)),
		"skipcontentsync": boolParam(userHostID == c.nodeID()),
	}
	// The user's list lives on their own node. Addressing that node directly
	// matters when this node holds no copy of the user: the entry would then be
	// unable to resolve where to write and would fail rather than delegate.
	var updatedUser any
	if userHostID != "" && userHostID != c.nodeID() {
		updatedUser, err = c.callRemote(userHostID, kind.byUserEntry, byUserParams)
	} else {
		updatedUser, err = c.callEntry(kind.byUserEntry, byUserParams)
	}
	if err != nil {
		c.errorf("Failed to call %s: %v, userId=%s, tweetId=%s", kind.byUserEntry, err, userID, tweetID)
		return c.wrapErrString(err), nil
	}

	c.debugf("local tweet=%s, user=%s", jsonStringify(updatedTweet), jsonStringify(updatedUser))
	return c.wrapPassthrough(map[string]any{
		"success": true,
		"user":    updatedUser,
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
	tweetSid, err := c.api.MMOpen(authSid, tweetID, verCur)
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
		if err := c.backupDelRef(tweetSid, tweetID, ""); err != nil {
			c.errorf("Error toggle %s of tweet: %v, request=%s", kind.tweetKey, err, c.requestJSON())
			return nil
		}
		if err := c.mimeiPublish(tweetSid, tweetID); err != nil {
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
	}
	return c.fetchTweetV2(tweetID, userID)
}

// engagementFlag reads one slot of a tweet's "favorites" triple.
func engagementFlag(tweet any, index int) bool {
	m, ok := toMap(tweet)
	if !ok {
		return false
	}
	flags := mapArr(m, "favorites")
	if index >= len(flags) {
		return false
	}
	return toBool(flags[index])
}

// ---------------------------------------------------------------------------
// User side
// ---------------------------------------------------------------------------

// toggleEngagementByUser records or clears a tweet in the user's own list.
//
// Bookmarking also pulls the tweet onto the user's node and announces it, so a
// saved tweet stays readable even if its author's node goes away. Removing does
// not reverse that: the copy may be the only one left, and other users' saves
// may depend on it.
func (c *ctx) toggleEngagementByUser(kind engagementKind) (any, error) {
	userID := c.str("userid")
	tweetID := c.str("tweetid")
	wanted := c.boolParam(kind.stateParam)
	skipContentSync := c.boolParam("skipcontentsync")

	// A failure after this point still returns the user's data, because the
	// client uses the reply to refresh its own view of the account.
	result, err := c.applyEngagementToUser(kind, userID, tweetID, wanted, skipContentSync)
	if err == nil {
		return result, nil
	}
	c.failf(err)
	userData, fallbackErr := c.callEntry("get_user_core_data", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userID,
	})
	if fallbackErr != nil {
		c.errorf("Failed to get user data after error: %v", fallbackErr)
		return c.wrapErr(fallbackErr), nil
	}
	return c.wrapNotNull(userData, "User not found"), nil
}

func (c *ctx) applyEngagementToUser(kind engagementKind, userID, tweetID string, wanted, skipContentSync bool) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return nil, err
	}
	// The list written here is the user's own, so this must be their root
	// node. The caller side of this pair addresses it directly, because the
	// tweet's list and the user's list live on different nodes.
	if err := c.requireRootNode(userID); err != nil {
		return nil, err
	}

	userSid, err := c.api.MMOpen(authSid, userID, verCur)
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
		if err := c.backupDelRef(userSid, userID, ""); err != nil {
			c.errorf("Failed to update %s list: %v, userId=%s, tweetId=%s", kind.userKey, err, userID, tweetID)
			return nil, err
		}
		if err := c.mimeiPublish(userSid, userID); err != nil {
			c.errorf("Failed to publish user %s: %v", userID, err)
		}
		if _, err := c.callEntry("node_update_score", map[string]string{
			reqAppID:  c.appID(),
			reqAppVer: verLast,
			"userid":  userID,
			reqMID:    userID,
		}); err != nil {
			c.errorf("Failed to update user score %s: %v", userID, err)
		}
	}

	if changed && wanted && !skipContentSync {
		// Saving a tweet means this node should hold it; ensureProvided skips
		// the pull when it already does. skipcontentsync is the caller's hint
		// that the tweet is on this node, which the provider table confirms.
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
