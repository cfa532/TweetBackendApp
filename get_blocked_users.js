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
    
    const BLOCKED_USERS = "blocked_users"  // Redis key for user's blocked users list

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        let userId = request["userid"]  // ID of user whose blocked list to retrieve
        let mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space
        let keys = lapi.Hkeys(mmsid, BLOCKED_USERS)  // Get all blocked user IDs
        return keys
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error get_blocked_users", e, JSON.stringify(request))
    }
})(request, args)