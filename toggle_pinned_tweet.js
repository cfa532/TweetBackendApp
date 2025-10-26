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
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // Delegate pinned tweet management to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("toggle_pinned_tweet", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                tweetid: tweetId, appuserid: appUserId}, []
            )
            
            // User mimei will be updated by system
            lapi.Debug("Toggle top tweets remote ret=", JSON.stringify(ret))
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
            lapi.MMBackup(authSid, appUserId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", appUserId)
            
            // Update user's score in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: appUserId, mid: appUserId}, [])

            return !pinned  // Return new pinned status
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Error toggle_pinned_tweet", JSON.stringify(request), e)
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