/**
 * Toggle Pinned Tweet Function
 * 
 * This function toggles the pinned status of a tweet for a user. It handles both
 * local and remote user pinned tweet management, allowing users to pin/unpin
 * their tweets for better organization and visibility.
 * 
 * Key Features:
 * - Toggles pinned status of tweets for users
 * - Handles both local and remote user pinned tweet management
 * - Updates user scores and publishes changes
 * - Returns updated pinned status
 * - Manages pinned tweet lists across distributed nodes
 * 
 * @param {Object} request - The request object containing pinned tweet data
 * @param {string} request.aid - Application ID
 * @param {string} request.tweetid - ID of tweet to pin/unpin
 * @param {string} request.appuserid - ID of user pinning/unpinning the tweet
 * @param {Array} args - Additional arguments (unused)
 * @returns {boolean} New pinned status (true for pinned, false for unpinned)
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    try {
        const PINNED_TWEETS = "pinned_tweet_list"  // Redis key for user's pinned tweets list
        const APP_ID = request["aid"]  // Application identifier
        const tweetId = request["tweetid"]  // ID of tweet to pin/unpin
        const appUserId = request["appuserid"]  // ID of user pinning/unpinning the tweet
        const user = getUser(appUserId)  // Get user data to determine hosting node

        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed toggle_pinned_tweet: missing host for user %s", JSON.stringify({appUserId, nodeId, user}))
            throw new Error("User not found or missing host")
        }
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (user.hostIds[0] !== nodeId) {
            // Delegate pinned tweet management to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("toggle_pinned_tweet", {aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    tweetid: tweetId, appuserid: appUserId}, []
                )
            } catch(e) {
                lapi.Error("Tweed toggle_pinned_tweet: Failed to call toggle_pinned_tweet on remote node %s: %s, appUserId=%s, tweetId=%s", user.hostIds[0], e, appUserId, tweetId)
                throw e
            }
            
            // User mimei will be updated by system
            lapi.Debug("Tweed toggle_pinned_tweet: remote ret=%s", JSON.stringify(ret))
            return ret
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, appUserId, "cur")  // Open user's memory space
            
            // ================================================================
            // PINNED TWEET STATUS TOGGLE
            // ================================================================
            
            // Check if tweet is already pinned
            const pinned = lapi.Hget(userSid, PINNED_TWEETS, tweetId)
            
            if (pinned) {
                // Remove from pinned tweets list
                lapi.Hdel(userSid, PINNED_TWEETS, tweetId)
            } else {
                // Add to pinned tweets list with timestamp
                lapi.Hset(userSid, PINNED_TWEETS, tweetId, Date.now())
            }
            
            // Update user data and publish changes
            try {
                lapi.MMBackup(authSid, appUserId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", appUserId)
            } catch(e) {
                lapi.Error("Tweed toggle_pinned_tweet: Failed to backup/publish user %s: %s", appUserId, e)
            }
            
            // Update user's score in AppData
            try {
                lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                    userid: appUserId, mid: appUserId}, [])
            } catch(e) {
                lapi.Error("Tweed toggle_pinned_tweet: Failed to update user score %s: %s", appUserId, e)
            }

            return !pinned  // Return new pinned status
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error toggle_pinned_tweet: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return false
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
            lapi.Error("Tweed toggle_pinned_tweet: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)