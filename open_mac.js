/**
 * Open Mac File Function
 * 
 * This function opens and retrieves data from a Mac file in the distributed
 * file system. It provides access to files stored using Mac-based identifiers
 * and returns the complete file content.
 * 
 * Key Features:
 * - Opens Mac files from the distributed file system
 * - Retrieves complete file content
 * - Handles Mac-based file identifiers
 * - Provides file access for distributed storage
 * 
 * @param {Object} request - The request object containing file data
 * @param {string} request.mac - Mac identifier for the file to open
 * @param {Array} args - Additional arguments (unused)
 * @returns {Uint8Array|null} File data as Uint8Array, or null if error occurs
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
                return {success: false, message: "File not found"}
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
        const authSid = lapi.BELoginAsAuthor()  // Get authentication session
        let fsid = lapi.MFOpenMacFile(authSid, "", request["mac"])  // Open Mac file
        const data = lapi.MFGetData(fsid, 0, -1)  // Get all file data (0 to end)
        return wrapResponse(data)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error open_mac: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
})(request, args)