// admin_tweet_entries.go — revocable moderation of top-level tweets.
package lapp

const adminUsername = "admin"

func (u userObj) adminTweetAccessRevoked() bool {
	return mapBool(u, "adminTweetAccessRevoked")
}

// requireDirectTweetOwner keeps old clients working until the account opts
// out. A legacy request has no way to distinguish its owner from an admin
// claiming the owner's id, so opted-out accounts must prove ownership.
func (c *ctx) requireDirectTweetOwner(userID string) error {
	user, err := c.knownUser(userID)
	if err != nil {
		return err
	}
	if err := c.requireRootNodeFor(user, userID); err != nil {
		return err
	}
	if user.adminTweetAccessRevoked() {
		return c.requireBoundOwner(user, userID)
	}
	return c.requireOwner(userID)
}

func entryAdminTweetAccess(c *ctx) (any, error) {
	userID := c.str("userid")
	user, err := c.knownUser(userID)
	if err != nil {
		return respErr(err), nil
	}
	if err := c.requireRootNodeFor(user, userID); err != nil {
		return respErr(err), nil
	}
	if !c.present("allowed") {
		return map[string]any{"success": true, "allowed": !user.adminTweetAccessRevoked()}, nil
	}

	allowed, err := parseBooleanOption("allowed", c.str("allowed"))
	if err != nil {
		return respErr(err), nil
	}
	if err := c.requireBoundOwner(user, userID); err != nil {
		return respErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	userSid, err := c.openMimei(authSid, userID, verCur)
	if err != nil {
		return respErr(err), nil
	}
	defer c.closeMimei(userSid)

	stored, err := c.getObject(userSid, ownerDataKey)
	if err != nil {
		return respErr(err), nil
	}
	if stored == nil {
		return respFail("User not found"), nil
	}
	stored["adminTweetAccessRevoked"] = !allowed
	if err := c.setValue(userSid, ownerDataKey, stored); err != nil {
		return respErr(err), nil
	}
	if err := c.backupDelRef(authSid, userID, ""); err != nil {
		return respErr(err), nil
	}
	if err := c.mimeiPublish(authSid, userID); err != nil {
		return respErr(err), nil
	}
	return map[string]any{"success": true, "allowed": allowed}, nil
}

// entryAdminMutateTweet verifies the signed-in admin on their own root before
// asking the tweet author's root to mutate the tweet.
func entryAdminMutateTweet(c *ctx) (any, error) {
	adminID, authorID := c.str("userid"), c.str("authorid")
	tweetID, action := c.str("tweetid"), c.str("action")
	if adminID == "" || authorID == "" || tweetID == "" || adminID == authorID {
		return respFail("Expected an admin, another author, and a tweet ID"), nil
	}
	if action != "update" && action != "delete" {
		return respFail("Expected an update or delete action"), nil
	}
	admin, err := c.knownUser(adminID)
	if err != nil {
		return respErr(err), nil
	}
	if admin.username() != adminUsername {
		return respFail("Only admin can moderate another user's tweet"), nil
	}
	if err := c.requireRootNodeFor(admin, adminID); err != nil {
		return respErr(err), nil
	}
	if err := c.requireBoundOwner(admin, adminID); err != nil {
		return respErr(err), nil
	}

	authorRoot, err := c.userRootNode(authorID)
	if err != nil {
		return respErr(err), nil
	}
	authSid, err := c.authSid()
	if err != nil {
		return respErr(err), nil
	}
	params := map[string]string{
		"userid": adminID, "authorid": authorID, "tweetid": tweetID, "action": action,
	}
	if action == "update" {
		for _, key := range []string{"content", "attachments", "downloadable", "isPrivate"} {
			if c.present(key) {
				params[key] = c.str(key)
			}
		}
	}
	reply, err := c.callPeerEntry(authSid, authorRoot, "apply_admin_tweet_mutation", params)
	if err != nil {
		return respErr(err), nil
	}
	response, ok := toMap(reply)
	if !ok || !has(response, "success") {
		return respFail("Tweet moderation unavailable on the author's node"), nil
	}
	return response, nil
}

func entryApplyAdminTweetMutation(c *ctx) (any, error) {
	adminID, authorID := c.str("userid"), c.str("authorid")
	tweetID, action := c.str("tweetid"), c.str("action")
	if adminID == "" || authorID == "" || tweetID == "" || adminID == authorID {
		return respFail("Expected an admin, another author, and a tweet ID"), nil
	}
	if err := c.requirePeerCall(adminID); err != nil {
		return respErr(err), nil
	}
	admin, err := c.knownUser(adminID)
	if err != nil {
		return respErr(err), nil
	}
	if admin.username() != adminUsername {
		return respFail("Only admin can moderate another user's tweet"), nil
	}
	author, err := c.knownUser(authorID)
	if err != nil {
		return respErr(err), nil
	}
	if err := c.requireRootNodeFor(author, authorID); err != nil {
		return respErr(err), nil
	}
	if author.adminTweetAccessRevoked() {
		return respFail("This author revoked admin access to their tweets"), nil
	}

	// Comments share the tweet object shape. Membership in the author's
	// own timeline limits this delegation to their top-level tweets.
	listed, err := c.listedInCommitted(authorID, userTweetList, tweetID)
	if err != nil {
		return respErr(err), nil
	}
	if !listed {
		return respFail("Cannot find the tweet"), nil
	}
	switch action {
	case "update":
		return c.updateTweet(authorID, tweetID)
	case "delete":
		return c.deleteTweet(authorID, authorID, tweetID, true)
	default:
		return respFail("Expected an update or delete action"), nil
	}
}
