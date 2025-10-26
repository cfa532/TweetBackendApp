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
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const authSid = lapi.BELoginAsAuthor()  // Get authentication session
        let fsid = lapi.MFOpenMacFile(authSid, "", request["mac"])  // Open Mac file
        return lapi.MFGetData(fsid, 0, -1)  // Get all file data (0 to end)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Open mac file", JSON.stringify(request), e)
    }
})(request, args)