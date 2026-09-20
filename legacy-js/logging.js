/**
 * Logging Function
 * 
 * This function provides a simple logging mechanism for the distributed social
 * media system. It accepts log messages and outputs them to the console for
 * debugging and monitoring purposes.
 * 
 * Key Features:
 * - Simple message logging to console
 * - Accepts any log message format
 * - Lightweight logging implementation
 * - Used for debugging and monitoring
 * 
 * @param {Object} request - The request object containing log data
 * @param {string} request.msg - Log message to output
 * @param {Array} args - Additional arguments (unused)
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
            return {success: false, message: error.message || String(error), error: error}
        }
        return undefined
    }
    
    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const msg = request["msg"]  // Log message to output
        lapi.Debug("Tweed logging: %s", msg)  // Output message to console
        return wrapResponse({success: true, message: "Logged successfully"})
    } catch(e) {
        lapi.Error("Tweed Error logging: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)