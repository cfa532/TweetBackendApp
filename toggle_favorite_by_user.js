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
    
    const FAVORITE_LIST = "favorite_list"  // Redis key for user's favorite list
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user whose favorites to update
    const tweetId = request["tweetid"]  // ID of tweet to add/remove from favorites
    const isFavorite = request["isfavorite"] === "true" ? true : false  // Convert string to boolean

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // Note: Boolean value is converted to string in the request
        const authSid = lapi.BELoginAsAuthor()
        const user = getUser(userId)  // Get user data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // Delegate favorite management to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const userData = lapi.RunMApp("toggle_favorite_by_user",
                { aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    userid: userId, tweetid: tweetId, isfavorite: isFavorite }, []
            )
            lapi.Debug("toggle_favorite_by_user remote", JSON.stringify(userData))
            return userData  // User local data will be updated by Leither
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
                lapi.Error("toggle_favorite_by_user error", e, JSON.stringify(request))
                throw e
            }
            
            // Publish user changes and update scores
            lapi.MiMeiPublish(userSid, "", userId)
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: userId, mid: userId}, [])
            
            // ================================================================
            // CONTENT SYNCHRONIZATION
            // ================================================================
            
            if (isFavorite) {
                // Sync and provide favorited content to ensure availability
                // Note: Content existence check could be implemented here
                // if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(authSid, "", tweetId, {})
                    lapi.MiMeiProvide(authSid, "", tweetId)
                // }
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
            lapi.Debug("toggle_favorite_by_user local", tweetId, JSON.stringify(updatedUser))
            return updatedUser
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("toggle_favorite_by_user error", e, JSON.stringify(request))
        
        // Return user data even if favorite operation failed
        return lapi.RunMApp("get_user_core_data", {aid: APP_ID, ver:"last",
            userid: userId}, []
        )
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
        const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
        const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
        return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
    }
})(request, args)