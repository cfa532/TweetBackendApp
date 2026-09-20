/**
 * Get Shared File IP Function
 * 
 * This function finds the best IP address of the sole provider for a shared file.
 * It analyzes provider data to find the optimal connection point based on
 * response scores for file retrieval.
 * 
 * Key Features:
 * - Finds the sole provider for a shared file
 * - Selects best IP based on response scores
 * - Handles provider data parsing
 * - Returns optimal connection point
 * 
 * @param {Object} request - The request object containing file data
 * @param {string} request.mid - Mimei ID of the shared file
 * @param {Array} args - Additional arguments (unused)
 * @returns {string|null} Best provider IP address, or null if not found
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === null || result === undefined || result === "") {
                return {success: false, message: "Shared file IP not found"}
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
        const ips = lapi.GetVar("", "mmprovsips", request["mid"])  // Get provider IP data
        if (!ips) return null
        
        const providers = JSON.parse(ips)  // Parse provider data
        if (!providers || !Array.isArray(providers)) return null
        
        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        let ip = ""  // Best IP address found
        let mini = null  // Lowest score found
        
        // Iterate through all providers to find the best one
        providers.forEach(element => {
            element.forEach(element2 => {
                // Iterate IP addresses of a provider to find the best one
                // element2 format: [ip:port, score] e.g., [183.156.208.29:1088, 3080507421]
                if (element2[1] < mini || mini === null) {
                    mini = element2[1]  // Update lowest score
                    ip = element2[0]  // Update best IP
                }
            })
        });
        
        lapi.Debug("Tweed get_shared_file_ip: ips=%s, ip=%s", ips, ip)
        return wrapResponse(ip || null)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_shared_file_ip: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)