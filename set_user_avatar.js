/**
 * Set User Avatar Function
 * 
 * This function updates a user's avatar in the distributed social media system.
 * It handles both local and remote user avatar updates, ensuring proper
 * synchronization and data consistency across the network.
 * 
 * Key Features:
 * - Updates user avatar information
 * - Handles both local and remote user avatar management
 * - Updates user scores and publishes changes
 * - Maintains data consistency across distributed nodes
 * - Returns updated avatar information
 * 
 * @param {Object} request - The request object containing avatar data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user whose avatar to update
 * @param {string} request.avatar - New avatar information
 * @param {Array} args - Additional arguments (unused)
 * @returns {string} Updated avatar information
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    try {
        const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
        const APP_ID = request["aid"]  // Application identifier
        const userId = request["userid"]  // ID of user whose avatar to update

        const authSid = lapi.BELoginAsAuthor()  // Get authentication session
        const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space
        const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)  // Get user data from storage

        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        if (!userInDB || !userInDB.hostIds || userInDB.hostIds.length === 0) {
            lapi.Error("Tweed set_user_avatar: missing host for user %s", JSON.stringify({userId, nodeId, userInDB}))
            throw new Error("User not found or missing host")
        }
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (userInDB.hostIds[0] !== nodeId) {
            // Delegate avatar update to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("set_user_avatar", {aid: APP_ID, ver: "last",
                    nid: userInDB.hostIds[0], sid: systemSid,
                    userid: userId, avatar: request["avatar"]}, []
                )
            } catch(e) {
                lapi.Error("Tweed set_user_avatar: Failed to call set_user_avatar on remote node %s: %s, userId=%s", userInDB.hostIds[0], e, userId)
                throw e
            }
            return ret
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // Update user avatar locally
            userInDB["avatar"] = request["avatar"]
            
            // Update user data and publish changes
            try {
                lapi.Set(userSid, OWNER_DATA_KEY, userInDB)
                lapi.MMBackup(userSid, userInDB.mid, "", "delref=true")
                lapi.MiMeiPublish(userSid, "", userInDB.mid)
            } catch(e) {
                lapi.Error("Tweed set_user_avatar: Failed to save/publish user %s: %s", userId, e)
                throw e
            }

            // Update the score of the user in AppData
            try {
                lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                    userid: userInDB.mid, mid: userInDB.mid}, [])
            } catch(e) {
                lapi.Error("Tweed set_user_avatar: Failed to update user score %s: %s", userId, e)
            }
            
            return request["avatar"]  // Return updated avatar
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error set_user_avatar: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return null
    }
})(request, args)