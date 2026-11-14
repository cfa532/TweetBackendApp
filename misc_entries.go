// misc_entries.go — health and diagnostics.
package lapp

// entryHealth reports that the node is serving this application. Clients call
// it to decide whether a node is reachable before sending real work.
func entryHealth(c *ctx) (any, error) {
	// A node whose configuration cannot be read still answers; registration
	// reports the failure when someone tries it.
	config, _ := c.loadNodeConfig()
	return map[string]any{
		"success": true,
		// userSessions tells a client this node checks "usersid", so it should
		// sign in to Leither here rather than send a password to be stored.
		"userSessions": true,
		// commentDelegation tells a client this node routes comments through
		// the writer's own root (add_comment/delete_comment there, peer
		// apply_comment/remove_comment on the parent author's node).
		"commentDelegation": true,
		// engagementDelegation says the same for likes, bookmarks and retweet
		// counts: toggle_* and retweet_* run on the engaging user's own root,
		// with apply_favorite/apply_bookmark/apply_retweet as the guarded peer
		// entries on the tweet author's node.
		"engagementDelegation": true,
		"guestRegistration": config.allowGuests,
		"message":           "Server is running",
		"storageFormats":    []string{"database", fileSchema},
		"creationFormat":    "mixed",
		"creationFormats": map[string]string{
			"user": fileSchema, "tweet": fileSchema, "comment": fileSchema,
			"messages": "database",
		},
	}, nil
}

// entryLogging records a client-supplied message in the node log, so a client
// can attach its own context to a server-side investigation.
func entryLogging(c *ctx) (any, error) {
	c.debugf("%s", c.str("msg"))
	return c.wrap(map[string]any{
		"success": true,
		"message": "Logged successfully",
	}), nil
}
