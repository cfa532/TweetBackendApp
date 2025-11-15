/**
 * Upload File Function
 * 
 * This function attaches a new file to a user's account. The file is stored
 * in IPFS (InterPlanetary File System) and its content identifier (CID) is
 * associated with the user's Mimei ID for reference tracking.
 * 
 * Key Features:
 * - Attaches files to user accounts
 * - Uses IPFS for distributed file storage
 * - Manages file references in user data
 * - Publishes changes to the network
 * - Handles file upload operations
 * 
 * @param {Object} request - The request object containing file data
 * @param {string} request.userid - ID of user to attach file to
 * @param {string} request.cid - Content identifier of the uploaded file
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
        const userId = request["userid"]  // ID of user to attach file to

        let authSid = lapi.BELoginAsAuthor()  // Get authentication session
        lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space
        
        // Add file reference to user's data
        lapi.MMAddRef(authSid, userId, request["cid"])
        
        // Update user data and publish changes
        try {
            lapi.MMBackup(authSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
        } catch(e) {
            lapi.Error("Tweed upload_file: Failed to backup/publish user %s: %s", userId, e)
        }

        lapi.Debug("Tweed upload_file: Attached file to user mid=%s", userId)
        return wrapResponse({success: true})
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error upload_file: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
})(request, args);