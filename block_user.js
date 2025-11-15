/**
 * Block User Function
 * 
 * This function blocks a user in a distributed social media system, preventing
 * them from appearing in the blocking user's feed and automatically unfollowing them.
 * 
 * Key Features:
 * - Handles both local and remote user blocking
 * - Automatically unfollows blocked users
 * - Removes blocked user's tweets from following feed
 * - Updates user data and publishes changes
 * 
 * Flow:
 * 1. Determines if blocking user is on local or remote node
 * 2. For remote users: delegates to appropriate node
 * 3. For local users: adds to blocked list and unfollows user
 * 4. Removes blocked user's tweets from following feed
 * 5. Updates user data and publishes changes
 * 
 * @param {Object} request - The request object containing blocking data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user performing the block action
 * @param {string} request.blocked - ID of user to be blocked
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const BLOCKED_USERS = "blocked_users"  // Redis key for user's blocked users list
    const FOLLOWINGS_TWEETS = "followings_tweets"  // Redis key for following tweets feed
    const FOLLOWINGS_LIST = "list_of_followings_mid"  // Redis key for list of followed user IDs
    const APP_ID = request["aid"]  // Application identifier
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            // If result already has success field, return as-is
            if (result && typeof result === 'object' && 'success' in result) {
                return result
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
        return {success: false}
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const blockedUserId = request["blocked"]  // ID of user to be blocked
        const userId = request["userid"]  // ID of user performing the block action
        const user = getUser(userId)  // Get blocking user's data
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed block_user: missing host for user %s", JSON.stringify({userId, nodeId, user}))
            throw new Error("User not found or missing host")
        }
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (user.hostIds[0] !== nodeId) {
            // Delegate block action to the node hosting the blocking user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("block_user", {aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    blocked: blockedUserId, userid: userId}, []
                )
            } catch(e) {
                lapi.Error("Tweed block_user: Failed to call block_user on remote node %s: %s, userId=%s, blockedUserId=%s", user.hostIds[0], e, userId, blockedUserId)
                throw e
            }
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // Add user to blocked list with timestamp
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            lapi.Hset(userSid, BLOCKED_USERS, blockedUserId, Date.now())

            // Automatically unfollow the blocked user
            const sps = lapi.RunMApp("get_tweet_id_list",
                {aid: APP_ID, ver: "last", userid: blockedUserId}, [])
                .map(e => e.Member)  // Extract tweet IDs from score pairs
            
            // Remove all blocked user's tweets from following feed
            lapi.Zrem(userSid, FOLLOWINGS_TWEETS, ...sps)
            
            // Remove blocked user from following list
            lapi.Hdel(userSid, FOLLOWINGS_LIST, blockedUserId)
            
            // Backup user data and publish changes
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userId)
            return wrapResponse({success: true})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error block_user: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
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
            lapi.Error("Tweed block_user: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)