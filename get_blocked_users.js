/**
 * Get Blocked Users Function
 * 
 * This function retrieves the list of users that have been blocked by a specific user.
 * It returns the user IDs of all blocked users from the user's blocked list.
 * 
 * Key Features:
 * - Retrieves blocked users list from user's data
 * - Returns array of blocked user IDs
 * - Simple and efficient lookup operation
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.userid - ID of user whose blocked list to retrieve
 * @param {Array} args - Additional arguments (unused)
 * @returns {Array} Array of blocked user IDs
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const BLOCKED_USERS = "blocked_users"  // Redis key for user's blocked users list
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error, data: []}
        }
        return []
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        let userId = request["userid"]  // ID of user whose blocked list to retrieve
        let mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space
        let keys = lapi.Hkeys(mmsid, BLOCKED_USERS)  // Get all blocked user IDs
        return wrapResponse(keys)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_blocked_users: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
})(request, args)