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
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const mmsid = lapi.MMOpen("", request["mid"], "last")  // Open file's memory space
        const file = lapi.MFGetObject(mmsid)  // Get file object content
        return file
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Error get_shared_file", JSON.stringify(request), e)
    }
})(request, args)