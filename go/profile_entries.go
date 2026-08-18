// profile_entries.go — profile updates, saved-item lists and account deletion.
package lapp

import (
	"fmt"
	"sort"
	"strings"

	"Leither/lapi"
)

// savedItemSyncGrace is how long a saved tweet whose content has not arrived is
// left alone. A tweet saved moments ago may simply still be synchronising, and
// removing it then would lose a bookmark the user just made.
const savedItemSyncGraceMillis = int64(5 * 60 * 1000)

// ---------------------------------------------------------------------------
// set_author_core_data
// ---------------------------------------------------------------------------

// entrySetAuthorCoreData updates an existing profile.
//
// Only the fields present in the request are touched; anything absent keeps its
// stored value, so a client that knows about fewer fields than the node cannot
// erase the rest.
//
// Moving an account between nodes runs through here as well. A changed primary
// host only warms the target node up; the profile itself is written on whichever
// node the client called. That is what lets an account move off a node that has
// since disappeared — the request lands on a surviving copy and is saved there
// rather than being refused.
func entrySetAuthorCoreData(c *ctx) (any, error) {
	raw, err := c.obj("user")
	if err != nil {
		return c.wrapErrUpdate(err), nil
	}
	user := userObj(raw)

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrUpdate(err), nil
	}
	userSid, err := c.api.MMOpen(authSid, user.mid(), verCur)
	if err != nil {
		return c.wrapErrUpdate(err), nil
	}
	defer c.closeMimei(userSid)

	stored, err := c.getObject(userSid, ownerDataKey)
	if err != nil {
		return c.wrapErrUpdate(err), nil
	}
	if stored == nil {
		return c.wrapErrUpdate(fmt.Errorf("User not found in database")), nil
	}
	userInDB := userObj(stored)

	nodeID := c.nodeID()
	systemSid, err := c.nodeDataSid(verCur)
	if err != nil {
		return c.wrapErrUpdate(err), nil
	}

	// A changed primary host means the account is being moved. Warm the target
	// node up first; if the old primary is already gone this is best-effort only.
	requestedHost := user.hostID()
	primaryHostChanged := requestedHost != "" && len(userInDB.hostIDs()) > 0 && requestedHost != userInDB.hostID()
	if primaryHostChanged {
		syncRet, err := c.callRemote(requestedHost, "sync_user", map[string]string{
			reqAppID:   c.appID(),
			reqAppVer:  verLast,
			reqSid:     systemSid,
			reqVersion: c.version(),
			reqMID:     user.mid(),
		})
		if err != nil {
			c.errorf("best-effort sync_user threw for new host %s: %v, userId=%s", requestedHost, err, user.mid())
		} else if m, ok := toMap(syncRet); ok && has(m, "success") && !mapBool(m, "success") {
			c.errorf("best-effort sync_user failed for new host %s: %s, userId=%s",
				requestedHost, mapStr(m, "message"), user.mid())
		}
	}

	// Without a requested host, keep whatever the stored account already has.
	if len(cleanHostIDs(user.hostIDs())) == 0 {
		if len(userInDB.hostIDs()) == 0 {
			c.errorf("missing host for user %s", jsonStringify(map[string]any{
				"userId": user.mid(), "nodeId": nodeID,
			}))
			return c.wrapErrUpdate(fmt.Errorf("User missing host")), nil
		}
		user["hostIds"] = strSlice(userInDB.hostIDs())
	}

	c.debugf("local user=%s", jsonStringify(map[string]any(user)))
	applyProfileUpdate(c, authSid, user, userInDB)

	if err := c.setValue(userSid, ownerDataKey, map[string]any(userInDB)); err != nil {
		c.errorf("Failed to save user data %s: %v", userInDB.mid(), err)
		return c.wrapErrUpdate(err), nil
	}
	if err := c.backupDelRef(userSid, userInDB.mid(), ""); err != nil {
		c.errorf("Failed to save user data %s: %v", userInDB.mid(), err)
		return c.wrapErrUpdate(err), nil
	}
	if err := c.mimeiProvide(authSid, userInDB.mid()); err != nil {
		c.warnf("provide %s failed: %v", userInDB.mid(), err)
	}
	if _, err := c.callEntry("node_update_score", map[string]string{
		reqAppID:  c.appID(),
		reqAppVer: verLast,
		"userid":  userInDB.mid(),
		reqMID:    userInDB.mid(),
	}); err != nil {
		c.warnf("node_update_score failed: %v", err)
	}

	userInDB.stripPassword()
	return c.wrapStatus(map[string]any{
		"user":   jsonStringify(map[string]any(userInDB)),
		"status": "success",
	}), nil
}

// applyProfileUpdate copies the supplied fields onto the stored account.
//
// Presence in the request, not truthiness, decides whether a field changes: an
// explicitly empty agent key or cloud drive port removes the setting, while an
// absent one leaves it alone.
func applyProfileUpdate(c *ctx, authSid string, user, userInDB userObj) {
	if hosts := cleanHostIDs(user.hostIDs()); len(hosts) > 0 {
		userInDB["hostIds"] = strSlice(hosts)
	}
	if pw := user.password(); pw != "" {
		hashed, err := c.contentID(authSid, pw)
		if err != nil {
			c.errorf("Failed to hash password for %s: %v", userInDB.mid(), err)
		} else {
			userInDB["password"] = hashed
		}
	}
	if _, ok := user["name"]; ok {
		userInDB["name"] = user["name"]
	}
	if _, ok := user["profile"]; ok {
		userInDB["profile"] = user["profile"]
	}

	// An empty agent key revokes agent access rather than storing a blank key.
	if _, ok := user["agentPublicKey"]; ok {
		if key := user.agentPublicKey(); key == "" {
			delete(userInDB, "agentPublicKey")
		} else {
			userInDB["agentPublicKey"] = key
		}
	}

	// Port 0 means "not configured" and is stored by removing the field, so a
	// zero is not mistaken for a real port.
	if rawPort, ok := user["cloudDrivePort"]; ok {
		port := ""
		if f, isNum := toFloat(rawPort); isNum {
			if f != 0 {
				port = formatNumber(f)
			}
		} else {
			port = strings.TrimSpace(toString(rawPort))
		}
		if port == "" {
			delete(userInDB, "cloudDrivePort")
		} else {
			userInDB["cloudDrivePort"] = port
		}
	}

	if rawDomain, ok := user["domainToShare"]; ok {
		if domain := strings.TrimSpace(toString(rawDomain)); domain == "" {
			delete(userInDB, "domainToShare")
		} else {
			userInDB["domainToShare"] = domain
		}
	}
}

// wrapErrUpdate reports a profile update failure. Legacy callers get a fixed
// reason rather than the underlying message.
func (c *ctx) wrapErrUpdate(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() {
		return respErr(err)
	}
	return map[string]any{"status": "failure", "reason": "Update failed"}
}

// ---------------------------------------------------------------------------
// get_user_meta
// ---------------------------------------------------------------------------

// entryGetUserMeta pages through a user's saved items: the comments they wrote,
// the tweets they bookmarked, or the tweets they favorited.
//
// Comments are returned as the stored field/value pairs. Bookmarks and
// favorites are resolved to whole tweets, newest save first.
func entryGetUserMeta(c *ctx) (any, error) {
	listType := c.str("type")
	switch listType {
	case userCommentList:
		var pairs []lapi.FVPair
		err := c.readMimei("", c.str("userid"), func(mmsid string) error {
			got, err := c.api.Hgetall(mmsid, userCommentList)
			if err != nil {
				return fmt.Errorf("Hgetall(%s): %v", userCommentList, err)
			}
			pairs = got
			return nil
		})
		if err != nil {
			return c.wrapErrList(err), nil
		}
		return c.wrap(pairs), nil

	case userBookmarkList, userFavoriteList:
		tweets, err := c.savedTweets(listType)
		if err != nil {
			return c.wrapErrList(err), nil
		}
		return c.wrap(tweets), nil
	}
	return c.wrapErrList(fmt.Errorf("Unsupported user metadata type: %s", listType)), nil
}

// wrapErrList reports a listing failure. The data field is an empty list so a
// v2 client can render the failure without a nil check.
func (c *ctx) wrapErrList(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() {
		out := respErr(err)
		out["data"] = []any{}
		return out
	}
	return []any{}
}

// savedTweets resolves one page of a user's bookmark or favorite list.
//
// The read is deliberately local: routine list loading must not force
// synchronisation, which is what the explicit recovery entries are for. An
// entry whose tweet is not held here yields a null in its place so the client
// can show a gap rather than silently renumbering the page.
//
// On the account's own root node this doubles as the only cleanup path for
// memberships whose tweet no longer exists anywhere. That cleanup is guarded
// three ways — root node only, older than the grace period, and unchanged since
// the page snapshot — because deleting a live bookmark is not recoverable.
func (c *ctx) savedTweets(listType string) ([]any, error) {
	userID := c.str("userid")
	appUserID := c.str("appuserid")
	pageNumber := c.intParam("pn", 0)
	pageSize := c.intParam("ps", 0)
	startRank := int(pageNumber * pageSize)
	nodeID := c.nodeID()

	readSid, err := c.api.MMOpen("", userID, verLast)
	if err != nil {
		return nil, fmt.Errorf("MMOpen(%s, last): %v", userID, err)
	}
	defer c.closeMimei(readSid)

	isRootNode := false
	if owner, err := c.getObject(readSid, ownerDataKey); err != nil {
		// A failed ownership check degrades to a read-only response; it must
		// never stop the list itself from loading.
		c.errorf("failed to resolve root node for userId=%s: %v", userID, err)
	} else if host := userObj(owner).hostID(); host != "" && host == nodeID {
		isRootNode = true
	}

	items, err := c.api.Hgetall(readSid, listType)
	if err != nil {
		return nil, fmt.Errorf("Hgetall(%s): %v", listType, err)
	}
	// Newest save first.
	sort.SliceStable(items, func(i, j int) bool {
		a, _ := toFloat(items[i].Value)
		b, _ := toFloat(items[j].Value)
		return a > b
	})

	fetchTweet := func(tweetID string) any {
		tweet, err := c.callEntry("get_tweet", map[string]string{
			reqAppID:    c.appID(),
			reqAppVer:   verLast,
			"appuserid": appUserID,
			"tweetid":   tweetID,
		})
		if err != nil {
			return nil
		}
		return tweet
	}

	// The writable handle is opened only if a removal actually becomes
	// necessary, so an ordinary page read stays a read.
	var writeSid, authSid string
	openWritable := func() string {
		if !isRootNode {
			return ""
		}
		if writeSid != "" {
			return writeSid
		}
		sid, err := c.authSid()
		if err != nil {
			c.errorf("failed to open write session for userId=%s: %v", userID, err)
			isRootNode = false
			return ""
		}
		mmsid, err := c.api.MMOpen(sid, userID, verCur)
		if err != nil {
			c.errorf("failed to open write session for userId=%s: %v", userID, err)
			isRootNode = false
			return ""
		}
		authSid, writeSid = sid, mmsid
		return writeSid
	}
	defer func() {
		if writeSid != "" {
			c.closeMimei(writeSid)
		}
	}()

	out := []any{}
	didModify := false
	// Scanning continues past a removal so the caller still receives a full
	// page and the next page does not skip an item shifted by the deletion.
	for index := startRank; index < len(items) && int64(len(out)) < pageSize; index++ {
		item := items[index]
		tweetID := item.Field

		if tweet := fetchTweet(tweetID); tweet != nil {
			out = append(out, tweet)
			continue
		}

		savedAt, savedAtOK := toInt64(item.Value)
		if !isRootNode || !savedAtOK || nowMillis()-savedAt < savedItemSyncGraceMillis {
			out = append(out, nil)
			continue
		}
		writable := openWritable()
		if writable == "" {
			out = append(out, nil)
			continue
		}

		// Re-read from the writable handle: a changed timestamp means the item
		// was saved again after this page's snapshot was taken.
		current, err := c.hget(writable, listType, tweetID)
		if err != nil {
			out = append(out, nil)
			continue
		}
		if current == nil {
			continue
		}
		if currentSavedAt, ok := toInt64(current); !ok || currentSavedAt != savedAt {
			out = append(out, nil)
			continue
		}

		// The content may have arrived since the first lookup.
		if tweet := fetchTweet(tweetID); tweet != nil {
			out = append(out, tweet)
			continue
		}

		if err := c.hdel(writable, listType, tweetID); err != nil {
			c.errorf("failed to remove stale tweetId=%s: %v", tweetID, err)
			out = append(out, nil)
			continue
		}
		didModify = true
		c.warnf("removed stale tweetId=%s from %s on root node=%s, savedAt=%d, userId=%s",
			tweetID, listType, nodeID, savedAt, userID)
	}

	if didModify {
		if err := c.backupDelRef(writeSid, userID, ""); err != nil {
			c.errorf("failed to persist/publish cleanup for userId=%s: %v", userID, err)
		} else if err := c.mimeiPublish(authSid, userID); err != nil {
			c.errorf("failed to persist/publish cleanup for userId=%s: %v", userID, err)
		}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// delete_account
// ---------------------------------------------------------------------------

// entryDeleteAccount removes an account and its tweets.
//
// Deletion runs on the account's root node. Tweets are deleted first so each
// one goes through delete_tweet and has its own references and list entries
// cleaned up; the account is then withdrawn from the network and its stored
// versions dropped.
func entryDeleteAccount(c *ctx) (any, error) {
	userID := c.str("userid")

	user, err := c.loadUser(userID)
	if err != nil {
		return c.wrapErrDelete(err), nil
	}
	if user == nil || !user.hasValidHost() {
		c.errorf("missing host for user %s", jsonStringify(map[string]any{
			"userId": userID, "nodeId": c.nodeID(),
		}))
		return c.wrapErrDelete(fmt.Errorf("User not found or missing host")), nil
	}

	// A failure to delete the tweets must not stop the account itself from
	// being removed; the user asked for the account to go.
	if err := c.deleteUserTweets(userID); err != nil {
		c.errorf("Failed to delete tweets: %v, userId=%s, request=%s", err, userID, c.requestJSON())
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrDelete(err), nil
	}
	if err := c.mimeiUnpublish(authSid, userID); err != nil {
		c.errorf("Failed to unpublish user %s: %v", userID, err)
	}
	if err := c.delVersions(authSid, userID); err != nil {
		c.errorf("Failed to delete user versions %s: %v", userID, err)
	}
	c.debugf("Deleted account %s", userID)
	return c.wrapPassthrough(map[string]any{"success": true}), nil
}

// deleteUserTweets deletes every tweet listed by an account.
func (c *ctx) deleteUserTweets(userID string) error {
	var ids []string
	err := c.readMimei("", userID, func(mmsid string) error {
		pairs, err := c.zrange(mmsid, userTweetList, 0, -1)
		if err != nil {
			return err
		}
		ids = members(pairs)
		return nil
	})
	if err != nil {
		return err
	}
	for _, tweetID := range ids {
		if _, err := c.callEntry("delete_tweet", map[string]string{
			reqAppID:  c.appID(),
			reqAppVer: verLast,
			"tweetid": tweetID,
			"userid":  userID,
		}); err != nil {
			c.warnf("delete_tweet %s failed: %v", tweetID, err)
		}
	}
	return nil
}

// wrapErrDelete reports a deletion failure in the envelope to every caller.
func (c *ctx) wrapErrDelete(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	return respErr(err)
}
