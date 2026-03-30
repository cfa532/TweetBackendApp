/**
 * Login Function
 * 
 * This function handles user authentication in the distributed social media system.
 * It validates user credentials, manages login sessions, and handles both local
 * and remote user authentication across the network.
 * 
 * Key Features:
 * - Validates username and password credentials
 * - Handles both local and remote user authentication
 * - Updates last login timestamps
 * - Validates user timestamp integrity
 * - Manages user session data
 * - Removes sensitive data before returning
 * 
 * @param {Object} request - The request object containing login data
 * @param {string} request.aid - Application ID
 * @param {string} request.username - Username for authentication
 * @param {string} request.password - Password for authentication
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Login result with user data and status
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const APP_EXT = "com.example.twitterclone"  // Application extension identifier
    const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
    const APP_ID = request["aid"]  // Application identifier
    const username = request["username"]  // Username for authentication
    const password = request["password"]  // Password for authentication
    const authSid = lapi.BELoginAsAuthor()  // Get authentication session
    const userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, username, 2, 0x07276704)  // Create user ID
    const userSid = lapi.MMOpen(authSid, userId, "last")  // Open user's memory space
    const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)  // Get user data from storage
    
    if (!userInDB) {
        lapi.Error("Tweed Error login: User not found for username: %s %s", username, userId);
        return wrapError(new Error("User not found"));
    }
    
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
        return {status: "failure", reason: error.message || String(error)}
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    let loginOK = false  // Track login success status
    
    // Note: Direct password comparison could be implemented here
    // delete userInDB.password
    // return {user: userInDB, status: "success"}
    
    try {
        // ========================================================================
        // PASSWORD VALIDATION
        // ========================================================================
        
        // Check hashed password against stored password
        if (userInDB.password === lapi.MMCreate(authSid, APP_ID, APP_EXT, password, 1, 0x07276704)) {
            // Login successful
            loginOK = true
            
            // Update last login time
            let nodeId = lapi.GetVar("", "hostid")  // Current node identifier
            
            // ====================================================================
            // REMOTE USER HANDLING
            // ====================================================================
            
            if (userInDB.hostIds?.length > 0 && userInDB.hostIds?.indexOf(nodeId) !== 0) {
                // Current node is not the writable host of the user data
                // Update last login time on the remote host
                let systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
                let ret
                try {
                    ret = lapi.RunMApp("login", {aid: APP_ID, ver: "last",
                        nid: userInDB.hostIds[0], sid: systemSid,
                        version: version,
                        username: username, password: password,
                    }, [])
                } catch(e) {
                    lapi.Error("Tweed login: Failed to call login on remote node %s: %s, username=%s", userInDB.hostIds[0], e, username)
                    throw e
                }
                return wrapResponse(ret)
            } else {
                // ================================================================
                // LOCAL USER HANDLING
                // ================================================================
                // Update last login timestamp
                userInDB["lastLogin"] = Date.now()

                lapi.Debug("Tweed login: user=%s", userInDB["username"])
                // ================================================================
                // TIMESTAMP VALIDATION
                // ================================================================
                
                // Check and validate user timestamp - must be in the past and not more than 2 years old
                const lastLoginTime = userInDB["lastLogin"]
                const twoYearsAgo = lastLoginTime - (2 * 365 * 24 * 60 * 60 * 1000)  // 2 years in milliseconds
                
                if (!userInDB.timestamp ||
                    typeof userInDB.timestamp !== 'number' ||
                    userInDB.timestamp <= 0 ||
                    userInDB.timestamp > lastLoginTime ||
                    userInDB.timestamp < twoYearsAgo) {
                    userInDB.timestamp = lastLoginTime  // Set to last login time if invalid
                }
                
                // Update user data and publish changes
                const userSid = lapi.MMOpen(authSid, userId, "cur")
                lapi.Set(userSid, OWNER_DATA_KEY, userInDB)
                lapi.MMBackup(authSid, userInDB.mid, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userInDB.mid)

                // ================================================================
                // SECURITY: Remove sensitive data before returning
                // ================================================================
                
                // Make sure to remove password from user data right before sending it back to client
                delete userInDB.password
                lapi.Debug("Tweed login succeeded: user=%s", JSON.stringify(userInDB))
                return wrapResponse({user: userInDB, status: "success"})
            }
        } else {
            // ====================================================================
            // AUTHENTICATION FAILURE
            // ====================================================================
            
            return wrapError(new Error("Wrong password"))
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error login: %s, loginOK=%s, userInDB=%s, request=%s", e, 
            loginOK, JSON.stringify(userInDB), JSON.stringify(request))
        
        if (loginOK) {
            // Login was successful but error occurred during processing
            delete userInDB.password  // Remove sensitive data
            return wrapResponse({user: userInDB, status: "success"})
        } else {
            // Login failed due to error
            return wrapError(new Error("Unknown error"))
        }
    }
})(request, args)