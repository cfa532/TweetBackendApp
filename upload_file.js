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
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const userId = request["userid"]  // ID of user to attach file to

        let authSid = lapi.BELoginAsAuthor()  // Get authentication session
        lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space
        
        // Add file reference to user's data
        lapi.MMAddRef(authSid, userId, request["cid"])
        
        // Update user data and publish changes
        lapi.MMBackup(authSid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)

        console.log("Attached to user a file mid=", userId)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("upload_package error:", e)
    }
})(request, args);