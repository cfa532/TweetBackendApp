// profile_entries.go — profile updates, saved-item lists and account deletion.
package lapp

import (
	"fmt"
	"sort"
	"strings"

	"Leither/lapi"
)

// ---------------------------------------------------------------------------
// set_author_core_data
// ---------------------------------------------------------------------------

// entrySetAuthorCoreData updates an existing profile.
//
// Only the fields present in the request are touched; anything absent keeps its
// stored value, so a client that knows about fewer fields than the node cannot
// erase the rest.
//
// Ordinary edits belong to the root. An explicit migration may start on a
// surviving copy when the old root is gone. Publish the changed ownership before
// the client pulls it onto the destination with a separately timed sync_user.
// This entry acknowledges the committed source, not migration completion.
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
	userSid, err := c.openMimei(authSid, user.mid(), verCur)
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

	// Root and agent-key changes could otherwise bypass tweet revocation or
	// divert the authority of the admin account during the legacy rollout.
	if userInDB.adminTweetAccessRevoked() || userInDB.username() == adminUsername {
		err = c.requireBoundOwner(userInDB, user.mid())
	} else {
		err = c.requireOwner(user.mid())
	}
	if err != nil {
		return c.wrapErrUpdate(err), nil
	}

	nodeID := c.nodeID()

	requestedHost := user.hostID()
	primaryHostChanged := requestedHost != "" && len(userInDB.hostIDs()) > 0 && requestedHost != userInDB.hostID()
	// migrate also identifies a retry after the source committed the new host
	// but destination synchronisation failed. The root ID may already match.
	migrating := c.str("migrate") == "true"
	if migrating {
		if requestedHost == "" {
			return c.wrapErrUpdate(fmt.Errorf("Migration requires a destination host")), nil
		}
	} else {
		if err := c.requireRootNodeFor(userInDB, user.mid()); err != nil {
			return c.wrapErrUpdate(err), nil
		}
		if primaryHostChanged {
			return c.wrapErrUpdate(fmt.Errorf("Changing the root host requires an explicit migration")), nil
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
	if err := c.backupDelRef(authSid, userInDB.mid(), ""); err != nil {
		c.errorf("Failed to save user data %s: %v", userInDB.mid(), err)
		return c.wrapErrUpdate(err), nil
	}
	if err := c.mimeiProvide(authSid, userInDB.mid()); err != nil {
		c.warnf("provide %s failed: %v", userInDB.mid(), err)
	}
	if err := c.mimeiPublish(authSid, userInDB.mid()); err != nil {
		return c.wrapErrUpdate(err), nil
	}

	userInDB.stripPassword()
	return c.wrapStatus(map[string]any{
		"user":           jsonStringify(map[string]any(userInDB)),
		"status":         "success",
		"migrationSaved": migrating,
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
	// A bound account's password is Leither's to keep; the client changes it
	// there (SetUserInfo), and nothing is stored in the account.
	if pw := user.password(); pw != "" && userInDB.authUID() == "" {
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
	c.failf(err)
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
			got, err := c.hgetall(mmsid, userCommentList)
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
	c.failf(err)
	if c.isV2() {
		out := respErr(err)
		out["data"] = []any{}
		return out
	}
	return []any{}
}

// savedTweets resolves one page of a user's bookmark or favorite list.
//
// Preserve the ID of an unreadable saved item so it can still be removed.
func (c *ctx) savedTweets(listType string) ([]any, error) {
	userID := c.str("userid")
	appUserID := c.str("appuserid")
	pageNumber := c.intParam("pn", 0)
	pageSize := c.intParam("ps", 0)
	startRank := int(pageNumber * pageSize)

	readSid, err := c.openMimei("", userID, verLast)
	if err != nil {
		return nil, fmt.Errorf("MMOpen(%s, last): %v", userID, err)
	}
	defer c.closeMimei(readSid)

	items, err := c.hgetall(readSid, listType)
	if err != nil {
		return nil, fmt.Errorf("Hgetall(%s): %v", listType, err)
	}
	// Newest save first.
	sort.SliceStable(items, func(i, j int) bool {
		a, _ := toFloat(items[i].Value)
		b, _ := toFloat(items[j].Value)
		return a > b
	})

	out := []any{}
	for index := startRank; index < len(items) && int64(len(out)) < pageSize; index++ {
		tweetID := items[index].Field
		item := c.fetchTweetV2(tweetID, appUserID)
		if item == nil {
			item = map[string]any{"mid": tweetID, "savedTweetUnavailable": true}
		}
		out = append(out, item)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// delete_account
// ---------------------------------------------------------------------------

// entryDeleteAccount removes an account and its tweets.
//
// Deletion runs on the account's root node. Tweets are deleted first so each
// one uses the normal tweet deletion path to have its references and list entries
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
	// Deleting anywhere else would drop a replica while the root kept serving
	// the account, so the deletion would appear to succeed and then undo itself
	// on the next synchronisation.
	if err := c.requireRootNodeFor(user, userID); err != nil {
		return c.wrapErrDelete(err), nil
	}
	if user.adminTweetAccessRevoked() || user.username() == adminUsername {
		err = c.requireBoundOwner(user, userID)
	} else {
		err = c.requireOwner(userID)
	}
	if err != nil {
		return c.wrapErrDelete(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrDelete(err), nil
	}

	// Keep the account and its remaining tweet references available for retry.
	if err := c.deleteUserTweets(authSid, userID); err != nil {
		return c.wrapErrDelete(err), nil
	}
	if err := c.mimeiUnpublish(authSid, userID); err != nil {
		return c.wrapErrDelete(fmt.Errorf("Failed to unpublish account: %v", err)), nil
	}
	if err := c.delVersions(authSid, userID); err != nil {
		return c.wrapErrDelete(err), nil
	}
	c.debugf("Deleted account %s", userID)
	return c.wrapPassthrough(map[string]any{"success": true}), nil
}

// deleteUserTweets deletes every tweet listed by an account.
func (c *ctx) deleteUserTweets(authSid, userID string) error {
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
		// The account and its timeline are read on their authoritative root.
		// If a prior attempt deleted the tweet but could not update the account,
		// finish removing its reference and list entries.
		exists, err := c.hasCommittedVersion(authSid, tweetID)
		if err != nil {
			return fmt.Errorf("Failed to inspect tweet %s: %v", tweetID, err)
		}
		authorID := userID
		if !exists {
			if err := c.delRef(authSid, userID, tweetID); err != nil {
				return err
			}
			authorID = ""
		}
		result, err := c.deleteTweet(userID, authorID, tweetID, false)
		if err != nil {
			return fmt.Errorf("Failed to delete tweet %s: %v", tweetID, err)
		}
		reply, _ := toMap(result)
		if !mapBool(reply, "success") {
			message := firstNonEmpty(mapStr(reply, "message"), mapStr(reply, "error"), "No confirmation from delete_tweet")
			return fmt.Errorf("Failed to delete tweet %s: %s", tweetID, message)
		}
	}
	return nil
}

// wrapErrDelete reports a deletion failure in the envelope to every caller.
func (c *ctx) wrapErrDelete(err error) any {
	c.failf(err)
	return respErr(err)
}
