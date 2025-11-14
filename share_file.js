/**
 * Share File Function
 * 
 * This function enables users to share files in the distributed social media system.
 * It creates file sharing entries, manages file metadata, and tracks sharing statistics
 * across the distributed network.
 * 
 * Key Features:
 * - Creates file sharing entries for users
 * - Handles both local and remote file sharing
 * - Manages file metadata and sharing statistics
 * - Tracks download counts and sharing permissions
 * - Supports file sharing across distributed nodes
 * 
 * @param {Object} request - The request object containing file sharing data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user sharing the file
 * @param {string} request.file - JSON string of file information
 * @param {Array} args - Additional arguments (unused)
 * @returns {string} Mimei ID of the shared file
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const APP_ID = request["aid"]  // Application identifier
    const APP_EXT = "com.example.twitterclone"  // Application extension identifier
    const USER_SHARE_MID = "shared_mid_of_user"  // Redis key for user's shared files
    const userId = request["userid"]  // ID of user sharing the file

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const user = getUser(userId)  // Get user data to determine hosting node
        const file = JSON.parse(request["file"])  // File path on user's hard drive that is being shared
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)  // Open application data node
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed share_file: missing host for user %s", JSON.stringify({userId, nodeId, user}))
            throw new Error("User not found or missing host")
        }
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (user.hostIds[0] !== nodeId) {
            // Delegate file sharing to the node hosting the user
            let ret
            try {
                ret = lapi.RunMApp("share_file", {aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    userid: userId, file: request["file"]}, []
                )
            } catch(e) {
                lapi.Error("Tweed share_file: Failed to call share_file on remote node %s: %s, userId=%s", user.hostIds[0], e, userId)
                throw e
            }
            return ret
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            const authSid = lapi.BELoginAsAuthor()
            const mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, file.path, 1, 0x07276704)  // Create Mimei ID for file
            const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space

            // ================================================================
            // CHECK FOR EXISTING SHARED FILE
            // ================================================================
            
            // If the mid exists, it has been shared, just return it
            const sharedObj = lapi.Hget(userSid, USER_SHARE_MID, mid)
            if (sharedObj) {
                lapi.Debug("Tweed share_file: shared file already exists, sharedObj=%s", JSON.stringify(sharedObj))
                return mid
            }

            // ================================================================
            // CREATE FILE SHARING ENTRY
            // ================================================================
            
            const fsid = lapi.MMOpen(authSid, mid, "cur")  // Open file's memory space
            
            // Set file metadata
            try {
                lapi.MFSetObject(fsid, {
                    userId: userId,  // ID of user sharing the file
                    path: file.path,  // File path on user's system
                    name: file.name,  // File name
                    size: file.size,  // File size in bytes
                    isDirectory: file.isDirectory,  // Whether it's a directory
                    modified: file.modified  // Time of sharing
                })
            } catch(e) {
                lapi.Error("Tweed share_file: Failed to set file object %s: %s", mid, e)
                throw e
            }
            
            // Update file data and publish changes
            try {
                lapi.MMBackup(fsid, mid, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", mid)
            } catch(e) {
                lapi.Error("Tweed share_file: Failed to backup/publish file %s: %s", mid, e)
            }
            lapi.Debug("Tweed share_file: shared file mid=%s, file=%s", mid, JSON.stringify(file))
    
            // ================================================================
            // UPDATE USER SHARING STATISTICS
            // ================================================================
            
            // Add file to user's shared files list with metadata
            try {
                lapi.Hset(userSid, USER_SHARE_MID, mid, {
                    downloadCount: 0,  // How many times the file has been downloaded
                    authorizedFor: null,  // Anybody can see it (no restrictions)
                    validTime: 0,  // Days of sharing (0 means forever)
                    modified: Date.now()  // Time of sharing
                })
            } catch(e) {
                lapi.Error("Tweed share_file: Failed to set shared file metadata %s: %s", mid, e)
            }
            
            // Update user data and publish changes
            try {
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)
            } catch(e) {
                lapi.Error("Tweed share_file: Failed to backup/publish user %s: %s", userId, e)
            }
    
            return mid  // Return the Mimei ID of the shared file
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error share_file: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return null
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Retrieves user data from the system
     * @param {string} mid - User ID to retrieve data for
     * @returns {Object|null} User data object or null if not found
     */
    function getUser(mid) {
        try {
            const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
            const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
            return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
        } catch(e) {
            lapi.Error("Tweed share_file: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)