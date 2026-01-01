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
    
    // Helper function to wrap response in JSON format for both v2 and v3
    function wrapResponse(result) {
        if (result === null || result === undefined) {
            return {success: false, message: "User not found"}
        }
        return {success: true, data: result}
    }

    // Helper function to wrap error response in JSON format for both v2 and v3
    function wrapError(error) {
        return {success: false, message: error.message || String(error), error: error}
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
            // User not found locally, but the node could be a provider by error, remove it.
            try {
                let authSid = lapi.BELoginAsAuthor()
                lapi.MiMeiUnprovide(authSid, "", userId)
            } catch(e) {
                // Version-specific behavior when unprovide fails
                if (version === 'v3') {
                    // v3: Log error but continue (will return null below)
                    lapi.Error("Tweed get_user: Failed to unprovide user %s: %s", userId, e)
                } else {
                    // v2 or no version: Log but continue to get provider IP
                    lapi.Error("Tweed get_user: Failed to unprovide user %s: %s", userId, e)
                }
            }
            
            // Version-specific behavior for provider IP lookup
            if (version === 'v3') {
                // v3: Don't attempt to get provider IP, already returned above or return null
                return wrapResponse(null)
            } else {
                // v2 or no version: Get provider IP for remote access
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
        }
    } catch(e) {
        lapi.Error("Tweed Error get_user: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)