/**
 * Toggle Favorite By User Function
 * 
 * This function updates a user's favorite list by adding or removing a tweet ID.
 * It handles both local and remote user favorite management, ensuring proper
 * synchronization and content availability for favorited tweets.
 * 
 * Key Features:
 * - Adds or removes tweets from user's favorite list
 * - Handles both local and remote user favorite management
 * - Syncs favorited content to ensure availability
 * - Updates user scores and publishes changes
 * - Manages content provision for favorited items
 * 
 * @param {Object} request - The request object containing favorite data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user whose favorites to update
 * @param {string} request.tweetid - ID of tweet to add/remove from favorites
 * @param {string} request.isfavorite - String "true" to add to favorites, "false" to remove
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Updated user data with favorite status
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const FAVORITE_LIST = "favorite_list"  // Redis key for user's favorite list
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user whose favorites to update
    const tweetId = request["tweetid"]  // ID of tweet to add/remove from favorites
    const isFavorite = request["isfavorite"] === "true" ? true : false  // Convert string to boolean
    
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
            lapi.Error("Tweed toggle_favorite_by_user: missing host for user %s", JSON.stringify({userId, nodeId, user}))
            throw new Error("User not found or missing host")
        }
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (user.hostIds[0] !== nodeId) {
            // Delegate favorite management to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let userData
            try {
                userData = lapi.RunMApp("toggle_favorite_by_user",
                    { aid: APP_ID, ver: "last",
                        nid: user.hostIds[0], sid: systemSid,
                        userid: userId, tweetid: tweetId, isfavorite: isFavorite }, []
                )
            } catch(e) {
                lapi.Error("Tweed toggle_favorite_by_user: Failed to call toggle_favorite_by_user on remote node %s: %s, userId=%s, tweetId=%s", user.hostIds[0], e, userId, tweetId)
                throw e
            }
            lapi.Debug("Tweed toggle_favorite_by_user: remote userData=%s", JSON.stringify(userData))
            return wrapResponse(userData)  // User local data will be updated by Leither
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space
            
            // ================================================================
            // FAVORITE LIST MANAGEMENT
            // ================================================================
            
            try {
                if (isFavorite) {
                    // Add tweet to user's favorite list with timestamp
                    lapi.Hset(userSid, FAVORITE_LIST, tweetId, Date.now())
                } else {
                    // Remove tweet from user's favorite list if it exists
                    if (lapi.Hget(userSid, FAVORITE_LIST, tweetId)) {
                        lapi.Hdel(userSid, FAVORITE_LIST, tweetId)
                    }
                }
                
                // Update user data and publish changes
                lapi.MMBackup(userSid, userId, "", "delref=true")
            } catch(e) {
                lapi.Error("Tweed toggle_favorite_by_user: Failed to update favorite list: %s, userId=%s, tweetId=%s", e, userId, tweetId)
                throw e
            }
            
            // Publish user changes and update scores
            try {
                lapi.MiMeiPublish(userSid, "", userId)
            } catch(e) {
                lapi.Error("Tweed toggle_favorite_by_user: Failed to publish user %s: %s", userId, e)
            }
            try {
                lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                    userid: userId, mid: userId}, [])
            } catch(e) {
                lapi.Error("Tweed toggle_favorite_by_user: Failed to update user score %s: %s", userId, e)
            }
            
            // ================================================================
            // CONTENT SYNCHRONIZATION
            // ================================================================
            
            if (isFavorite) {
                // Sync and provide favorited content to ensure availability
                try {
                    lapi.MiMeiSync(authSid, "", tweetId, {})
                } catch(e) {
                    lapi.Error("Tweed toggle_favorite_by_user: Failed to sync tweet %s: %s", tweetId, e)
                }
                try {
                    lapi.MiMeiProvide(authSid, "", tweetId)
                } catch(e) {
                    lapi.Error("Tweed toggle_favorite_by_user: Failed to provide tweet %s: %s", tweetId, e)
                }
            } else {
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
            lapi.Debug("Tweed toggle_favorite_by_user: local tweetId=%s, userData=%s", tweetId, JSON.stringify(updatedUser))
            return wrapResponse(updatedUser)
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error toggle_favorite_by_user: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        
        // Return user data even if favorite operation failed
        try {
            const userData = lapi.RunMApp("get_user_core_data", {aid: APP_ID, ver:"last",
                userid: userId}, []
            )
            return wrapResponse(userData)
        } catch(e2) {
            lapi.Error("Tweed toggle_favorite_by_user: Failed to get user data after error: %s", e2)
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
            lapi.Error("Tweed toggle_favorite_by_user: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)