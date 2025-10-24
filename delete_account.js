/**
 * Delete Account Function
 * 
 * This function permanently deletes a user account and all associated data
 * in a distributed social media system. It handles both local and remote
 * user account deletion.
 * 
 * Key Features:
 * - Handles both local and remote user account deletion
 * - Deletes all user tweets before removing account
 * - Unpublishes user data from the network
 * - Removes all versions of user data
 * 
 * Flow:
 * 1. Determines if user is on local or remote node
 * 2. For remote users: delegates to appropriate node
 * 3. For local users: deletes all tweets then removes account
 * 4. Unpublishes user data and removes all versions
 * 
 * @param {Object} request - The request object containing deletion data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user account to delete
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const TWT_LIST_KEY = "list_of_tweets_mid"  // Redis key for user's tweet list
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user account to delete

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const user = getUser(userId)  // Get user data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // Delegate account deletion to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("delete_account", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid, userid: userId}, []
            )
            return ret
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // Delete all user tweets before removing the account
            try {
                const userSid = lapi.MMOpen("", userId, "last")
                lapi.Zrange(userSid, TWT_LIST_KEY, 0, -1).forEach(e => {
                    // Delete each tweet individually
                    lapi.RunMApp("delete_tweet", {aid: APP_ID, ver: "last",
                        tweetid: e.Member, userid: userId}, []
                    )
                })
            } catch(e) {
                console.error("Error delete_account: delete tweets", e, JSON.stringify(request))
            }

            // Remove user account and all associated data
            const authSid = lapi.BELoginAsAuthor()
            lapi.MiMeiUnpublish(authSid, "", userId)  // Remove user from network
            lapi.MMDelVers(authSid, userId)  // Delete all versions of user data
            console.log("Deleted account ", userId)
            return {success: true}
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error delete_account:", e, JSON.stringify(request))
        return {success: false, message: e}
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