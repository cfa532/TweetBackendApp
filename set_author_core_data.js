/**
 * Set Author Core Data Function
 * 
 * This function handles updating registered user profile information in the distributed
 * social media system. It manages user data updates including name, profile, password,
 * host IDs, and cloud drive settings while ensuring data consistency across nodes.
 * 
 * Key Features:
 * - Updates user profile information (name, profile, password)
 * - Handles both local and remote user data updates
 * - Manages host ID changes and user migration
 * - Updates cloud drive port settings
 * - Ensures data consistency across distributed nodes
 * - Validates user existence before updates
 * - Syncs user data when host changes occur
 * 
 * @param {Object} request - The request object containing user update data
 * @param {string} request.aid - Application ID
 * @param {string} request.user - JSON string of updated user data object
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Update result with user data and status
 */
((request, args) => {
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
    const APP_ID = request["aid"]  // Application ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"  // Application extension identifier
    
    // Parse and validate user data from request
    const user = JSON.parse(request["user"])  // Parsed user data object
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            // If result already has success/status field, ensure it's in v2 format
            if (result && typeof result === 'object') {
                if ('status' in result && !('success' in result)) {
                    return {success: result.status === 'success', ...result}
                }
                if ('success' in result) {
                    return result
                }
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
        return {status: "failure", reason: "Update failed"}
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // Initialize authentication and data access
        const authSid = lapi.BELoginAsAuthor()  // Get authentication session
        const userSid = lapi.MMOpen(authSid, user.mid, "cur")  // Open user's memory space
        const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)  // Get existing user data from storage
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)  // Open application data node

        // ========================================================================
        // USER VALIDATION
        // ========================================================================
        
        // Validate that user exists in database
        if (!userInDB) {
            throw new Error("User not found in database")
        }

        // ========================================================================
        // HOST ID CHANGE HANDLING
        // ========================================================================
        
        // Check if the primary host ID has changed. When this request arrives on
        // a surviving access node, the old primary may already be gone. In that
        // case, this sync is only a best-effort warmup for the new target node;
        // the local copy below is still authoritative enough to save the update.
        const primaryHostChanged = user.hostIds && user.hostIds[0] && userInDB.hostIds && user.hostIds[0] !== userInDB.hostIds[0]
        if (primaryHostChanged) {
            try {
                // Make sure user mimei is available on the new hostId
                const syncRet = lapi.RunMApp("sync_user", {
                    aid: APP_ID,
                    ver: "last",
                    nid: user.hostIds[0],
                    sid: systemSid,
                    version: version,
                    mid: user.mid
                }, [])
                if (syncRet && syncRet.success === false) {
                    lapi.Error("Tweed set_author_core_data: best-effort sync_user failed for new host %s: %s, userId=%s", user.hostIds[0], syncRet.message || JSON.stringify(syncRet), user.mid)
                }
            } catch(e) {
                lapi.Error("Tweed set_author_core_data: best-effort sync_user threw for new host %s: %s, userId=%s", user.hostIds[0], e, user.mid)
            }
        }

        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        // If user has no valid hostIds, keep existing hostIds
        if (!user.hostIds || user.hostIds.length === 0) {
            if (!userInDB.hostIds || userInDB.hostIds.length === 0) {
                lapi.Error("Tweed set_author_core_data: missing host for user %s", JSON.stringify({userId: user.mid, nodeId, user}))
                throw new Error("User missing host")
            }
            // Use existing hostIds from database
            user.hostIds = userInDB.hostIds
        }
        
        // Check if we need to delegate to the primary host
        let shouldUpdateLocally = user.hostIds[0] === nodeId
        if (!shouldUpdateLocally) {
            lapi.Debug("Tweed set_author_core_data: local user=%s", JSON.stringify(user))
            
            // Delegate the update to the primary host
            let ret
            try {
                ret = lapi.RunMApp("set_author_core_data", {
                    aid: APP_ID,
                    ver: "last",
                    nid: user.hostIds[0],
                    sid: systemSid,
                    version: version,
                    user: request["user"]
                }, [])
            } catch(e) {
                lapi.Error("Tweed set_author_core_data: Failed to call set_author_core_data on remote node %s: %s, userId=%s", user.hostIds[0], e, user.mid)
                if (!primaryHostChanged) {
                    throw e
                }
                shouldUpdateLocally = true
            }
            
            lapi.Debug("Tweed set_author_core_data: local ret=%s", JSON.stringify(ret))

            if (ret && ret.success === false) {
                lapi.Error("Tweed set_author_core_data: remote update failed on new primary %s: %s, userId=%s", user.hostIds[0], ret.message || JSON.stringify(ret), user.mid)
                if (!primaryHostChanged) {
                    return wrapResponse(ret)
                }
                shouldUpdateLocally = true
            }
            
            if (!shouldUpdateLocally) {
                // Sync the updated data from the remote host (assume the remote host is up to date)
                lapi.MiMeiSync(systemSid, "", user.mid, {})
                lapi.MiMeiProvide(systemSid, "", user.mid)
                
                // Get the updated user data from the local host for logging
                try {
                    const newUser = lapi.RunMApp("get_user_core_data", {
                        aid: APP_ID, 
                        ver: "last",
                        userid: user.mid
                    }, [])
                    lapi.Debug("Tweed set_author_core_data: local newUser=%s", JSON.stringify(newUser))
                } catch(e) {
                    // This is just for logging, so it's OK if it fails
                    lapi.Error("Tweed set_author_core_data: Failed to get user data after sync: %s", e)
                }
                return wrapResponse(ret)
            }
        }

        if (shouldUpdateLocally) {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            // We are on the primary host, or on a surviving access-node copy after
            // the old primary disappeared during host migration. Save locally.
            
            // ================================================================
            // USER DATA UPDATE
            // ================================================================
            
            // If user update without providing hostIds, keep the old ones
            if (user.hostIds && user.hostIds.length > 0) {
                userInDB.hostIds = user.hostIds
            }
            
            // When user update without providing password, keep the old one
            if (user.password) {
                userInDB.password = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)
            }
            
            // Update user profile information
            if (user.name !== undefined) {
                userInDB.name = user.name  // Update user's display name
            }
            if (user.profile !== undefined) {
                userInDB.profile = user.profile  // Update user's profile information
            }
            
            // Update agent public key for AI agent authentication
            if (user.agentPublicKey !== undefined) {
                if (user.agentPublicKey === null || user.agentPublicKey === '') {
                    delete userInDB.agentPublicKey  // Remove agent key (revoke access)
                } else {
                    userInDB.agentPublicKey = user.agentPublicKey  // Set new agent public key
                }
            }

            // Update cloudDrivePort - only modify if explicitly provided in request
            // Use Number() instead of || '' to correctly handle 0 (a valid "unset" value)
            if ('cloudDrivePort' in user) {
                const portNum = Number(user.cloudDrivePort)
                const trimmedPort = isNaN(portNum) ? String(user.cloudDrivePort || '').trim() : (portNum === 0 ? '' : String(portNum))
                if (trimmedPort === '') {
                    delete userInDB.cloudDrivePort
                } else {
                    userInDB.cloudDrivePort = trimmedPort
                }
            }
            // else: cloudDrivePort not in request — preserve existing value in DB

            // Update domainToShare - only modify if explicitly provided in request
            if ('domainToShare' in user) {
                const trimmedDomain = user.domainToShare == null ? '' : String(user.domainToShare).trim()
                if (trimmedDomain === '') {
                    delete userInDB.domainToShare
                } else {
                    userInDB.domainToShare = trimmedDomain
                }
            }
            // else: domainToShare not in request — preserve existing value in DB

            // ================================================================
            // DATA PERSISTENCE AND PUBLICATION
            // ================================================================
            
            // Save the updated user data
            try {
                lapi.Set(userSid, OWNER_DATA_KEY, userInDB)
                lapi.MMBackup(userSid, userInDB.mid, "", "delref=true")
                lapi.MiMeiProvide(authSid, "", userInDB.mid)
            } catch(e) {
                lapi.Error("Tweed set_author_core_data: Failed to save user data %s: %s", userInDB.mid, e)
                throw e
            }
            
            // Update the user's score in application data
            lapi.RunMApp("node_update_score", {
                aid: APP_ID, 
                ver: "last",
                userid: userInDB.mid, 
                mid: userInDB.mid
            }, [])

            // ================================================================
            // SECURITY: Remove sensitive data before returning
            // ================================================================
            
            // Remove password from response for security
            delete userInDB.password
            return wrapResponse({user: JSON.stringify(userInDB), status: "success"})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error set_author_core_data: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)
