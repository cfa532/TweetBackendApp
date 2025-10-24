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
    
    // IMPORTANT: Boolean values are passed as strings "true"/"false"
    
    const isFollower = request["isfollower"]  // String "true" or "false" indicating follower status
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user whose follower status is being updated
    const otherId = request["otherid"]  // ID of user whose follower status is being toggled
    
    // Prevent self-following scenarios
    if (userId === otherId) {
        return  // Don't allow users to follow themselves
    }

    const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    const user = getUser(userId)  // Get user data to determine hosting node

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // Delegate follower status update to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId, otherid: otherId, isfollower: isFollower}, [])
            
            // Update user's score on the remote node
            lapi.RunMApp("node_update_mid_by_score", {aid: APP_ID, ver:"last",
                hostid: user.hostIds[0], userid: userId, mid: userId}, [])
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
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: userId, mid: userId}, [])
            
            console.log(userId, "with follower", otherId, isFollower)
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error toggle_follower", JSON.stringify(request), e)
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