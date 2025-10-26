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
    
    const APP_EXT = "com.example.twitterclone"  // Application extension identifier
    const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
    const APP_ID = request["aid"]  // Application identifier
    const username = request["username"]  // Username for authentication
    const password = request["password"]  // Password for authentication
    const authSid = lapi.BELoginAsAuthor()  // Get authentication session
    const userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, username, 2, 0x07276704)  // Create user ID
    const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space
    const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)  // Get user data from storage

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
        if (userInDB.password == lapi.MMCreate(authSid, APP_ID, APP_EXT, password, 1, 0x07276704)) {
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
                return lapi.RunMApp("login", {aid: APP_ID, ver: "last",
                    nid: userInDB.hostIds[0], sid: systemSid,
                    username: username, password: password,
                }, [])
            } else {
                // ================================================================
                // LOCAL USER HANDLING
                // ================================================================
                // Update last login timestamp
                userInDB["lastLogin"] = Date.now()
                
                // ================================================================
                // TIMESTAMP VALIDATION
                // ================================================================
                
                // Check and validate user timestamp - must be in the past and not more than 2 years old
                const currentTime = userInDB["lastLogin"]
                const twoYearsAgo = currentTime - (2 * 365 * 24 * 60 * 60 * 1000)  // 2 years in milliseconds
                
                if (!userInDB.timestamp || 
                    typeof userInDB.timestamp !== 'number' || 
                    userInDB.timestamp <= 0 || 
                    userInDB.timestamp > currentTime || 
                    userInDB.timestamp < twoYearsAgo) {
                    userInDB.timestamp = currentTime  // Set to current time if invalid
                }
                
                // Update user data and publish changes
                lapi.Set(userSid, OWNER_DATA_KEY, userInDB)
                lapi.MMBackup(authSid, userInDB.mid, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userInDB.mid)

                // ================================================================
                // SECURITY: Remove sensitive data before returning
                // ================================================================
                
                // Make sure to remove password from user data right before sending it back to client
                delete userInDB.password
                return {user: userInDB, status: "success"}
            }
        } else {
            // ====================================================================
            // AUTHENTICATION FAILURE
            // ====================================================================
            
            return {status: "failure", reason: "Wrong password"}
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Error login", loginOK, JSON.stringify(request), e)
        
        if (loginOK) {
            // Login was successful but error occurred during processing
            delete userInDB.password  // Remove sensitive data
            return {user: userInDB, status: "success"}
        } else {
            // Login failed due to error
            return {status: "failure", reason: "Unknown error"}
        }
    }
})(request, args)