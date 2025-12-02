/**
 * Get Shared File Function
 * 
 * This function retrieves the content of a shared file from the distributed network.
 * It opens the file's memory space and returns the file object for download or access.
 * 
 * Key Features:
 * - Retrieves shared file content from network
 * - Opens file memory space for access
 * - Returns file object for download
 * - Handles file access errors gracefully
 * 
 * @param {Object} request - The request object containing file data
 * @param {string} request.mid - Mimei ID of the shared file to retrieve
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object|null} File object content, or null if not found
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
        const mmsid = lapi.MMOpen("", request["mid"], "last")  // Open file's memory space
        const file = lapi.MFGetObject(mmsid)  // Get file object content
        return wrapResponse(file)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_shared_file: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)