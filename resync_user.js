/**
 * Resync User Function
 * 
 * This function ensures the current node has the most up-to-date version of a user
 * by syncing the user data from their primary host before retrieving it. Unlike
 * get_user, this function guarantees fresh user data by performing synchronization.
 * 
 * Key Features:
 * - Syncs user data from primary host to ensure current information
 * - Updates user content and tweets to latest versions
 * - Handles both local and remote user synchronization
 * - Returns fresh user data with updated information
 * - Ensures data consistency across distributed nodes
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user to resync
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object|null} Fresh user data object, or null if error occurs
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const userId = request["userid"]  // ID of user to resync
    
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
        const user = getUser(userId)  // Get user data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed resync_user: missing host for user %s", JSON.stringify({userId, nodeId, user}))
            throw new Error("User not found or missing host")
        }
        
        // ========================================================================
        // USER SYNCHRONIZATION
        // ========================================================================
        
        if (user.hostIds[0] !== nodeId) {
            // Make sure the current user is up to date by syncing from primary host
            lapi.RunMApp("node_update_mid_by_score", {aid: request["aid"], ver:"last",
                hostid: user.hostIds[0], userid: userId, mid: userId}, [])
        }
        
        // ========================================================================
        // FRESH USER DATA RETRIEVAL
        // ========================================================================
        
        // Get the fresh user data after synchronization
        const userData = lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last",
            userid: userId}, [])
        
        if (!userData) {
            throw new Error("Failed to retrieve user data after synchronization")
        }
        
        return wrapResponse(userData)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error resync_user: %s, request=%s", e, JSON.stringify(request))
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
            lapi.Error("Tweed resync_user: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)