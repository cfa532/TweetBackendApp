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
    
    const version = request.version || ""  // Version identifier for API compatibility
    const TWT_LIST_KEY = "list_of_tweets_mid"  // Redis key for user's tweet list
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user account to delete
    
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
        return {success: false, message: error}
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const user = getUser(userId)  // Get user data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed delete_account: missing host for user %s", JSON.stringify({userId, nodeId, user}))
            throw new Error("User not found or missing host")
        }
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (user.hostIds[0] !== nodeId) {
            // Delegate account deletion to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("delete_account", {aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid, userid: userId}, []
                )
            } catch(e) {
                lapi.Error("Tweed delete_account: Failed to call delete_account on remote node %s: %s, userId=%s", user.hostIds[0], e, userId)
                throw e
            }
            return wrapResponse(ret)
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
                lapi.Error("Tweed delete_account: Failed to delete tweets: %s, userId=%s, request=%s", e, userId, JSON.stringify(request))
            }

            // Remove user account and all associated data
            const authSid = lapi.BELoginAsAuthor()
            try {
                lapi.MiMeiUnpublish(authSid, "", userId)  // Remove user from network
            } catch(e) {
                lapi.Error("Tweed delete_account: Failed to unpublish user %s: %s", userId, e)
            }
            try {
                lapi.MMDelVers(authSid, userId)  // Delete all versions of user data
            } catch(e) {
                lapi.Error("Tweed delete_account: Failed to delete user versions %s: %s", userId, e)
            }
            lapi.Debug("Tweed delete_account: Deleted account %s", userId)
            return wrapResponse({success: true})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error delete_account: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
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
            lapi.Error("Tweed delete_account: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)