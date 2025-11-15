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
 * @param {Array} args - Additional arguments (unused)
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
    const user = JSON.parse(request["user"])  // Parsed user data object
    const followings = request["followings"] ? JSON.parse(request["followings"]) : []  // Initial following list
    const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    
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
    
    try {
        lapi.Debug("Tweed register: nodeId=%s, user=%s, followings=%s", nodeId, request["user"], request["followings"])
        
        // ========================================================================
        // REMOTE USER REGISTRATION
        // ========================================================================
        
        if (user.hostIds?.length > 0 && user.hostIds[0] !== nodeId) {
            // Register user on their preferred remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("register", {aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    user: request["user"], followings: request["followings"]}, []
                )
            } catch(e) {
                lapi.Error("Tweed register: Failed to call register on remote node %s: %s, username=%s", user.hostIds[0], e, user.username)
                throw e
            }
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL USER REGISTRATION
            // ====================================================================
            // Register user on current node
            const authSid = lapi.BELoginAsAuthor()
            const userMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.username, 2, 0x07276704)
    
            // ================================================================
            // USERNAME UNIQUENESS VALIDATION
            // ================================================================
            
            // Check if username is already taken by looking for existing provider
            // Result of GetVar is a string literal "[]", we need to parse it to an array
            const providerIp = lapi.RunMApp("get_provider_ip", {aid: APP_ID, ver: "last",
                mid: userMid}, [])
            if (providerIp) {
                lapi.Error("Tweed register: User register failed. Existing user %s", JSON.stringify(providerIp))
                return wrapError(new Error("Username is taken"))
            }
            
            // ================================================================
            // USER DATA SETUP
            // ================================================================
            
            user["mid"] = userMid  // Set user's unique identifier
            user["password"] = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)  // Hash password
            user["timestamp"] = Date.now()  // Set creation timestamp
            
            // Set host IDs if not provided
            if (!user["hostIds"] || user["hostIds"].length < 1) {
                user["hostIds"] = [nodeId]
            }
            
            // ================================================================
            // USER DATA STORAGE
            // ================================================================
            
            const userSid = lapi.MMOpen(authSid, userMid, "cur")
            lapi.Set(userSid, OWNER_DATA_KEY, user)  // Create default user data area
            lapi.MMBackup(userSid, userMid, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userMid)  // Publish user data so toggle_following can find the new user
    
            // ================================================================
            // INITIAL FOLLOWING SETUP
            // ================================================================
            
            // Set up initial following relationships
            followings?.forEach(mid => {
                try {
                    lapi.RunMApp("toggle_following", {aid: APP_ID, ver: "last",
                        userid: user.mid, followingid: mid}, [])
                } catch(e) {
                    lapi.Error("Tweed register: Error in register when toggle_following: %s, request=%s", e, JSON.stringify(request))
                }
            });
    
            // Note: App data update could be implemented here
            // lapi.RunMApp("update_app_data", {aid: APP_ID, ver: "last", user: JSON.stringify(user)}, [])
            
            lapi.Debug("Tweed register: User registered %s", JSON.stringify(user))
            delete user.password  // Remove sensitive data before returning
            return wrapResponse({user: JSON.stringify(user), status: "success"})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error register: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
})(request, args)
