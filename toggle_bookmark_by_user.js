/**
 * Toggle Bookmark By User Function
 * 
 * This function updates a user's bookmark list by adding or removing a tweet ID.
 * It handles both local and remote user bookmark management, ensuring proper
 * synchronization and content availability for bookmarked tweets.
 * 
 * Key Features:
 * - Adds or removes tweets from user's bookmark list
 * - Handles both local and remote user bookmark management
 * - Syncs bookmarked content to ensure availability
 * - Updates user scores and publishes changes
 * - Manages content provision for bookmarked items
 * 
 * @param {Object} request - The request object containing bookmark data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user whose bookmarks to update
 * @param {string} request.tweetid - ID of tweet to add/remove from bookmarks
 * @param {string} request.isbookmarked - String "true" to add to bookmarks, "false" to remove
 * @param {boolean|string} [request.skipcontentsync] - Skip sync/provide when content is already on this node
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Updated user data with bookmark status
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const BOOKMARK_LIST = "bookmark_list"  // Redis key for user's bookmark list
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user whose bookmarks to update
    const tweetId = request["tweetid"]  // ID of tweet to add/remove from bookmarks
    const isBookmarked = request["isbookmarked"] === true || request["isbookmarked"] === "true"  // Accept both boolean and string
    const skipContentSync = request["skipcontentsync"] === true || request["skipcontentsync"] === "true"
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === null || result === undefined) {
                return {success: false, message: "User not found"}
            }
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error}
        }
        return null
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // Note: Boolean value is converted to string in the request
        const authSid = lapi.BELoginAsAuthor()
        const user = getUser(userId)  // Get user data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed toggle_bookmark_by_user: missing host for user %s", JSON.stringify({userId, nodeId, user}))
            throw new Error("User not found or missing host")
        }
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (user.hostIds[0] !== nodeId) {
            // Delegate bookmark management to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let userData
            try {
                userData = lapi.RunMApp("toggle_bookmark_by_user",
                    { aid: APP_ID, ver: "last",
                        nid: user.hostIds[0], sid: systemSid,
                        version: version,
                        userid: userId, tweetid: tweetId, isbookmarked: isBookmarked,
                        skipcontentsync: skipContentSync}, []
                )
            } catch(e) {
                lapi.Error("Tweed toggle_bookmark_by_user: Failed to call toggle_bookmark_by_user on remote node %s: %s, userId=%s, tweetId=%s", user.hostIds[0], e, userId, tweetId)
                throw e
            }
            lapi.Debug("Tweed toggle_bookmark_by_user: remote userData=%s", JSON.stringify(userData))
            return wrapResponse(userData)
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space
            
            // ================================================================
            // BOOKMARK LIST MANAGEMENT
            // ================================================================
            
            const wasBookmarked = lapi.Hget(userSid, BOOKMARK_LIST, tweetId) ? true : false
            const bookmarkChanged = isBookmarked !== wasBookmarked

            if (bookmarkChanged) {
                try {
                    if (isBookmarked) {
                        // Add tweet to user's bookmark list with timestamp
                        lapi.Hset(userSid, BOOKMARK_LIST, tweetId, Date.now())
                    } else {
                        lapi.Hdel(userSid, BOOKMARK_LIST, tweetId)
                    }

                    // Update user data and publish changes
                    lapi.MMBackup(userSid, userId, "", "delref=false")
                } catch(e) {
                    lapi.Error("Tweed toggle_bookmark_by_user: Failed to update bookmark list: %s, userId=%s, tweetId=%s", e, userId, tweetId)
                    throw e
                }

                // Publish user changes and update scores
                try {
                    lapi.MiMeiPublish(userSid, "", userId)
                } catch(e) {
                    lapi.Error("Tweed toggle_bookmark_by_user: Failed to publish user %s: %s", userId, e)
                }
                try {
                    lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                        userid: userId, mid: userId}, [])
                } catch(e) {
                    lapi.Error("Tweed toggle_bookmark_by_user: Failed to update user score %s: %s", userId, e)
                }
            }
            
            // ================================================================
            // CONTENT SYNCHRONIZATION
            // ================================================================
            
            if (bookmarkChanged && isBookmarked && !skipContentSync) {
                // Saving a tweet means this node should hold it. One it already
                // provides is kept current by Leither, so only a tweet missing
                // from the provider table is pulled. skipcontentsync is the
                // caller's hint for the same thing; this confirms it locally.
                try {
                    if (!lapi.MiMeiIsProvider(authSid, tweetId)) {
                        lapi.MiMeiSync(authSid, "", tweetId, {})
                        lapi.MiMeiProvide(authSid, "", tweetId)
                    }
                } catch(e) {
                    lapi.Error("Tweed toggle_bookmark_by_user: Failed to provide tweet %s: %s", tweetId, e)
                }
            } else if (bookmarkChanged && !isBookmarked) {
                // TODO: Prevent the tweet from being deleted if it is on the same node
                // Note: Unproviding content is commented out to prevent premature deletion
                // lapi.MiMeiUnprovide(authSid, "", tweetId)
                // lapi.MMDelVers(authSid, tweetId)
            }
            
            // ================================================================
            // RETURN UPDATED USER DATA
            // ================================================================
            
            const updatedUser = lapi.RunMApp("get_user_core_data", {aid: APP_ID, ver:"last",
                userid: userId}, []
            )
            lapi.Debug("Tweed toggle_bookmark_by_user: local tweetId=%s, userData=%s", tweetId, JSON.stringify(updatedUser))
            return wrapResponse(updatedUser)
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error toggle_bookmark_by_user: %s, request=%s", e, JSON.stringify(request))
        
        // Return user data even if bookmark operation failed
        try {
            const userData = lapi.RunMApp("get_user_core_data", {aid: APP_ID, ver:"last",
                userid: userId}, []
            )
            return wrapResponse(userData)
        } catch(e2) {
            lapi.Error("Tweed toggle_bookmark_by_user: Failed to get user data after error: %s", e2)
            return wrapError(e2)
        }
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Retrieves user data from the system
     * @param {string} mid - User ID to retrieve data for
     * @returns {Object|null} User data object or null if not found
     */
    function getUser(mid) {
        try {
            const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
            const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
            return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
        } catch(e) {
            lapi.Error("Tweed toggle_bookmark_by_user: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)
