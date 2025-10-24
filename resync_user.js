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
    
    const userId = request["userid"]  // ID of user to resync
    const user = getUser(userId)  // Get user data to determine hosting node

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // USER SYNCHRONIZATION
        // ========================================================================
        
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // Make sure the current user is up to date by syncing from primary host
            lapi.RunMApp("node_update_mid_by_score", {aid: request["aid"], ver:"last",
                hostid: user.hostIds[0], userid: userId, mid: userId}, [])
        }
        
        // ========================================================================
        // FRESH USER DATA RETRIEVAL
        // ========================================================================
        
        // Get the fresh user data after synchronization
        return lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last",
            userid: userId}, [])
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error resync_user:", e, JSON.stringify(request))
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