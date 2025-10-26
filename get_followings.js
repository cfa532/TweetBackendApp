/**
 * Get Followings Function
 * 
 * This function retrieves the list of users that a specific user is following,
 * along with their complete user profile data. It converts user IDs to full
 * user objects for comprehensive following information.
 * 
 * Key Features:
 * - Retrieves following list with complete user data
 * - Returns user objects instead of just IDs
 * - Filters out invalid or missing user data
 * - Provides success/failure status
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user whose following list to retrieve
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Object containing users array and success status
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    try {
        const FOLLOWINGS_LIST = "list_of_followings_mid"  // Redis key for user's following list
        let userId = request["userid"]  // ID of user whose following list to retrieve
        let mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space
        
        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Get list of followed user IDs
        const userIds = lapi.Hkeys(mmsid, FOLLOWINGS_LIST)
        
        // Convert user IDs to complete user objects
        const users = userIds.map(userId => {
            return lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last",
                userid: userId}, [])
        }).filter(e=> e)  // Remove null/undefined results
        
        return {users: users, success: true}
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Error get_followings", JSON.stringify(request), e)
        return {users: [], success: false}
    }
})(request, args)
