/**
 * Open Temp File Function
 * 
 * This function creates a temporary file in the distributed file system.
 * It provides a temporary storage mechanism for file operations and returns
 * a file system ID that can be used for subsequent file operations.
 * 
 * Key Features:
 * - Creates temporary files in the distributed file system
 * - Returns file system ID for file operations
 * - Handles authentication for file creation
 * - Provides temporary storage for file processing
 * 
 * @param {Object} request - The request object (unused in this function)
 * @param {Array} args - Additional arguments (unused)
 * @returns {string|null} File system ID for the temporary file, or null if error occurs
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
                return {success: false, message: "Failed to create temp file"}
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
        let authSid = lapi.BELoginAsAuthor()  // Get authentication session
        let fsid = lapi.MFOpenTempFile(authSid);  // Create temporary file
        return wrapResponse(fsid)  // Return file system ID
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error open_temp_file: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)