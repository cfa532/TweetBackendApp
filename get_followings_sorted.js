/**
 * Get Followings Sorted Function
 * 
 * This function retrieves the list of users that a specific user is following.
 * It returns all followed users with their associated metadata (timestamps, etc.).
 * 
 * Key Features:
 * - Retrieves complete following list with metadata
 * - Returns hash map of followed user IDs and their data
 * - Simple and efficient lookup operation
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.userid - ID of user whose following list to retrieve
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Hash map of followed user IDs and their metadata
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
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
            return {success: false, message: error.message || String(error), error: error, data: {}}
        }
        return {}
    }
    
    try {
        const FOLLOWINGS_LIST = "list_of_followings_mid"  // Redis key for user's following list
        let userId = request["userid"]  // ID of user whose following list to retrieve
        let mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space
        
        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Get all followed users with their associated metadata
        return wrapResponse(lapi.Hgetall(mmsid, FOLLOWINGS_LIST))
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_followings_sorted: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
})(request, args)