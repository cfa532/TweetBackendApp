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
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        let authSid = lapi.BELoginAsAuthor();  // Get authentication session
        let fsid = request["fsid"]? request["fsid"] : lapi.MFOpenTempFile(authSid);  // Get or create file system ID
        
        // ========================================================================
        // UPLOAD COMPLETION HANDLING
        // ========================================================================
        
        if (request["finished"] === "true") {
            if (request["referenceid"] === undefined) {
                // No reference to add, this is an attachment of a tweet
                // It will be added as reference to the tweetId later
                return lapi.MFTemp2Ipfs(fsid, null)
            }
            
            // Add new IPFS as reference to a parent Mimei, usually a userId
            return lapi.MFTemp2Ipfs(fsid, request["referenceid"])
        }
        
        // ========================================================================
        // CHUNKED UPLOAD HANDLING
        // ========================================================================
        
        let offset = parseInt(request["offset"], 10)  // Byte offset for chunk placement
        let b = new Uint8Array(args[0])  // Key point: chunk data as ByteArray
        lapi.MFSetData(fsid, b, offset);  // Store chunk at specified offset
        return fsid;  // Return file system ID for next chunk
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Error upload_ipfs:", JSON.stringify(request), e)
    }
})(request, args);