/**
 * Toggle Follower Function
 * 
 * This function manages the follower status between two users in a distributed
 * social media system. It updates the follower list for a specific user when
 * another user follows or unfollows them.
 * 
 * Key Features:
 * - Handles both local and remote follower status updates
 * - Manages follower list additions and removals
 * - Updates user scores and publishes changes
 * - Prevents self-following scenarios
 * 
 * Important Note: Boolean values are passed as strings "true"/"false"
 * 
 * @param {Object} request - The request object containing follower data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user whose follower status is being updated
 * @param {string} request.otherid - ID of user whose follower status is being toggled
 * @param {string} request.isfollower - String "true" or "false" indicating follower status
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
    // IMPORTANT: Boolean values are passed as strings "true"/"false"
    
    const isFollower = request["isfollower"]  // String "true" or "false" indicating follower status
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user whose follower status is being updated
    const otherId = request["otherid"]  // ID of user whose follower status is being toggled
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === undefined || result === null) {
                return {success: false, message: "Operation failed"}
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
        return undefined
    }
    
    // Prevent self-following scenarios
    if (userId === otherId) {
        return wrapError(new Error("Cannot follow yourself"))  // Don't allow users to follow themselves
    }

    const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    const user = getUser(userId)  // Get user data to determine hosting node

    if (!user || !user.hostIds || user.hostIds.length === 0) {
        lapi.Error("Tweed toggle_follower: missing host for user %s", JSON.stringify({userId, nodeId, user}))
        return wrapError(new Error("User host not found"))
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (user.hostIds[0] !== nodeId) {
            // Delegate follower status update to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    version: version,
                    userid: userId, otherid: otherId, isfollower: isFollower}, [])
            } catch(e) {
                lapi.Error("Tweed toggle_follower: Failed to call toggle_follower on remote node %s: %s, userId=%s, otherId=%s", user.hostIds[0], e, userId, otherId)
                throw e
            }
            
            // Update user's score on the remote node
            try {
                lapi.RunMApp("node_update_mid_by_score", {aid: APP_ID, ver:"last",
                    hostid: user.hostIds[0], userid: userId, mid: userId}, [])
            } catch(e) {
                lapi.Error("Tweed toggle_follower: Failed to update user score on remote node %s: %s, userId=%s", user.hostIds[0], e, userId)
                // Don't throw - this is a non-critical operation
            }
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            const FOLLOWERS_LIST = "list_of_followers_mid"  // Redis key for user's followers list
            const authSid = lapi.BELoginAsAuthor()  // Get authentication session
            const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space
    
            if (isFollower === "true") {
                // Add otherId as a follower of userId
                lapi.Hset(userSid, FOLLOWERS_LIST, otherId, Date.now())
            } else {
                // Remove otherId from userId's followers list
                lapi.Hdel(userSid, FOLLOWERS_LIST, otherId)
            }
            
            // Update user data and publish changes
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
    
            // Update the user's score in application data
            try {
                lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                    userid: userId, mid: userId}, [])
            } catch(e) {
                lapi.Error("Tweed toggle_follower: Failed to update user score: %s, userId=%s", e, userId)
                // Don't throw - this is a cleanup operation
            }
            
            lapi.Debug("Tweed toggle_follower: %s with follower %s, isFollower=%s", userId, otherId, isFollower)
            return wrapResponse({success: true, isFollower: isFollower === "true"})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error toggle_follower: %s, request=%s", e, JSON.stringify(request))
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
            lapi.Error("Tweed toggle_follower: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)