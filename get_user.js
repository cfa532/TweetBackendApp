/**
 * Get User Function
 * 
 * This function retrieves user data from the local database if available,
 * otherwise returns the IP address of a provider with the least response time.
 * It serves as a fallback mechanism for user data retrieval across the network.
 * 
 * Key Features:
 * - Attempts to get user data from local database first
 * - Falls back to provider IP lookup if user not found locally
 * - Provides network routing information for remote users
 * - Handles error cases gracefully
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.userid - ID of user to retrieve data for
 * @param {string} request.aid - Application ID
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object|string|null} User data object, provider IP address, or null if not found
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
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
    
    try {
        const userId = request["userid"]  // ID of user to retrieve data for

        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Try to get the user's data from local node first
        const user = lapi.RunMApp("get_user_core_data", {aid: request.aid, ver:"last",
            userid: userId}, [])
            
        if (user) {
            // User found locally, return user data
            return wrapResponse(user)
        } else {
            // User not found locally, get provider IP for remote access
            const ip = lapi.RunMApp("get_provider_ip", {aid: request.aid, ver:"last",
                mid: userId}, [])
            
            if (ip) {
                // Return provider IP for remote user access
                lapi.Debug("Tweed get_user: new ip %s", ip)
                return wrapResponse(ip)
            } else {
                // No provider found, throw error
                throw new Error("No provider IP found.")
            }
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_user: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
})(request, args)