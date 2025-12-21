/**
 * Upload IPFS Function
 * 
 * This function handles the upload of data to IPFS (InterPlanetary File System).
 * It processes chunked data uploads and converts temporary files to IPFS
 * content identifiers (CIDs) for distributed storage.
 * 
 * Key Features:
 * - Handles chunked data uploads to IPFS
 * - Manages temporary file storage during upload
 * - Converts files to IPFS content identifiers
 * - Supports file attachments and references
 * - Handles both chunked and final upload operations
 * 
 * @param {Object} request - The request object containing upload data
 * @param {string} request.fsid - File system ID for temporary storage
 * @param {string} request.finished - String 'true' if upload is complete
 * @param {string} [request.referenceid] - Optional reference ID for file attachment
 * @param {string} request.offset - Byte offset for chunked uploads
 * @param {Array} args - Array containing chunk data (ByteArray)
 * @returns {string} File system ID or IPFS CID depending on upload stage
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
                return {success: false, message: "Upload failed"}
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
        let authSid = lapi.BELoginAsAuthor();  // Get authentication session
        let fsid = request["fsid"]? request["fsid"] : lapi.MFOpenTempFile(authSid);  // Get or create file system ID
        
        // ========================================================================
        // UPLOAD COMPLETION HANDLING
        // ========================================================================
        
        if (request["finished"] === "true") {
            let cid = lapi.MFTemp2Ipfs(fsid, null)
            let referenceId = request["referenceid"]
            if (referenceId) {
                // Add new IPFS as reference to a parent Mimei, usually a userId
                lapi.Debug("Tweed upload_ipfs: Adding %s as reference to mid=%s", cid, referenceId)
                let authSid = lapi.BELoginAsAuthor()
                let sid = lapi.MMOpen(authSid, referenceId, "cur")
                lapi.MMAddRef(sid, referenceId, cid)
                lapi.MMBackup(sid, referenceId, "", "delref=true")
            }

            // No reference to add, this is an attachment of a tweet
            // It will be added as reference to the tweetId later
            return wrapResponse(cid)
        }
        
        // ========================================================================
        // CHUNKED UPLOAD HANDLING
        // ========================================================================
        
        let offset = parseInt(request["offset"], 10)  // Byte offset for chunk placement
        let b = new Uint8Array(args[0])  // Key point: chunk data as ByteArray
        lapi.MFSetData(fsid, b, offset);  // Store chunk at specified offset
        return wrapResponse(fsid);  // Return file system ID for next chunk
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error upload_ipfs: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args);