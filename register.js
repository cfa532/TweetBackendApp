/**
 * Register Function
 * 
 * This function handles new user registration in the distributed social media system.
 * It creates user accounts, manages user data, and sets up initial following relationships.
 * The function handles both local and remote user registration based on user's host preferences.
 * 
 * Key Features:
 * - Creates new user accounts with unique identifiers
 * - Handles both local and remote user registration
 * - Validates username uniqueness
 * - Sets up initial following relationships
 * - Manages user data and authentication
 * - Publishes user data to the network
 * 
 * @param {Object} request - The request object containing registration data
 * @param {string} request.aid - Application ID
 * @param {string} request.user - JSON string of user data object
 * @param {string} [request.followings] - JSON string of initial following list
 * @returns {Object} Registration result with user data and status
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const APP_ID = request["aid"]  // Application ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"  // Application extension identifier
    const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
    const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            // If result already has success/status field, ensure it's in v2 format
            if (result && typeof result === 'object') {
                // Special handling for success status: return user object directly
                if ('status' in result && result.status === 'success' && 'user' in result) {
                    // Parse user if it's a string, otherwise use as-is
                    const userObj = typeof result.user === 'string' ? JSON.parse(result.user) : result.user
                    return {success: true, user: userObj}
                }
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
    // INPUT VALIDATION
    // ============================================================================

    // Validate required request parameters
    if (!request || !request["aid"]) {
        return wrapError(new Error("Missing application ID"))
    }

    if (!request["user"]) {
        return wrapError(new Error("Missing user data"))
    }

    // Parse and validate user data
    let user
    try {
        user = JSON.parse(request["user"])
    } catch (e) {
        lapi.Error("Tweed register: Invalid user JSON: %s", request["user"])
        return wrapError(new Error("Invalid user data format"))
    }

    // Validate username format (basic check)
    if (user.username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(user.username)) {
        return wrapError(new Error("Invalid username format"))
    }

    // Validate hostIds if provided (should contain valid node IDs, not empty strings)
    if (user.hostIds && Array.isArray(user.hostIds)) {
        // Filter out empty strings and invalid entries
        user.hostIds = user.hostIds.filter(id => id && typeof id === 'string' && id.trim().length > 0)
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================

    try {
        lapi.Debug("Tweed register: nodeId=%s, user=%s", nodeId, request["user"])

        // ========================================================================
        // REMOTE USER REGISTRATION
        // ========================================================================

        // Check if user wants to register on a different node
        // Only proceed if hostIds contains at least one valid node ID different from current node
        const shouldRegisterRemote = user.hostIds && user.hostIds.length > 0 && user.hostIds[0] &&
                                   user.hostIds[0].length == 27 && user.hostIds[0] !== nodeId

        if (shouldRegisterRemote) {
            // Validate remote node ID
            const targetNodeId = user.hostIds[0]
            if (!targetNodeId || targetNodeId.trim().length === 0) {
                lapi.Error("Tweed register: Invalid remote node ID: %s", targetNodeId)
                return wrapError(new Error("Invalid remote node ID"))
            }

            // Register user on their preferred remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("register", {aid: APP_ID, ver: "last",
                    nid: targetNodeId, sid: systemSid,
                    version: version,
                    user: request["user"]}, []
                )
            } catch(e) {
                lapi.Error("Tweed register: Failed to call register on remote node %s: %s, username=%s", targetNodeId, e, user.username)
                return wrapError(new Error(`Remote registration failed: ${e.message || String(e)}`))
            }
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL USER REGISTRATION
            // ====================================================================

            // Register user on current node
            const authSid = lapi.BELoginAsAuthor()
            let userMid
            try {
                userMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.username, 2, 0x07276704)
            } catch (e) {
                lapi.Error("Tweed register: Failed to create user MID for %s: %s", user.username, e)
                return wrapError(new Error("Failed to create user account"))
            }

            // ================================================================
            // USERNAME UNIQUENESS VALIDATION
            // ================================================================

            // Check if username is already taken by looking for existing provider
            let providerIp
            try {
                providerIp = lapi.RunMApp("get_provider_ip", {aid: APP_ID, ver: "last",
                    mid: userMid}, [])
            } catch (e) {
                lapi.Error("Tweed register: Failed to check provider for user %s: %s", user.username, e)
                return wrapError(new Error("Failed to validate username uniqueness"))
            }

            if (providerIp) {
                lapi.Error("Tweed register: User register failed. Existing %s at %s", user.username, providerIp)
                return wrapError(new Error("Username is taken"))
            }
            
            // ================================================================
            // USER DATA SETUP
            // ================================================================

            // Sanitize and set user data
            user["mid"] = userMid  // Set user's unique identifier

            // Hash password securely
            try {
                user["password"] = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)
            } catch (e) {
                lapi.Error("Tweed register: Failed to hash password for user %s: %s", user.username, e)
                return wrapError(new Error("Failed to process password"))
            }

            user["timestamp"] = Date.now()  // Set creation timestamp
            user["lastLogin"] = Date.now()  // Set initial last login time

            // Ensure name and profile are strings
            user["name"] = (user["name"] || "").toString().trim()
            user["profile"] = (user["profile"] || "").toString().trim()

            // Normalize cloudDrivePort to integer (0 means not configured)
            const cloudDrivePort = parseInt(user["cloudDrivePort"]) || 0
            user["cloudDrivePort"] = cloudDrivePort

            // Set host IDs if not provided or invalid
            if (!user["hostIds"] || !Array.isArray(user["hostIds"]) || user["hostIds"].length < 1) {
                user["hostIds"] = [nodeId]
            } else {
                // Ensure all hostIds are valid strings
                user["hostIds"] = user["hostIds"].filter(id => id && typeof id === 'string' && id.trim().length > 0)
                if (user["hostIds"].length === 0) {
                    user["hostIds"] = [nodeId]
                }
            }
            
            // ================================================================
            // USER DATA STORAGE
            // ================================================================

            let userSid
            try {
                userSid = lapi.MMOpen(authSid, userMid, "cur")
            } catch (e) {
                lapi.Error("Tweed register: Failed to open user storage for %s: %s", user.username, e)
                return wrapError(new Error("Failed to create user storage"))
            }

            try {
                lapi.Set(userSid, OWNER_DATA_KEY, user)  // Create default user data area
            } catch (e) {
                lapi.Error("Tweed register: Failed to save user data for %s: %s", user.username, e)
                return wrapError(new Error("Failed to save user data"))
            }

            lapi.MMBackup(userSid, userMid, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userMid)  // Publish user data so toggle_following can find the new user
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver: "last", userid: userMid, mid: userMid}, [])
            
            lapi.Debug("Tweed register: User registered %s", JSON.stringify(user))
            delete user.password  // Remove sensitive data before returning
            return wrapResponse({user: JSON.stringify(user), status: "success"})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error register: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)
