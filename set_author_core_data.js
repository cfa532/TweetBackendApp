/**
 * Update registered user data
 * 
 * This function handles updating user profile information including name, profile,
 * password, and host IDs. It ensures data consistency across nodes and handles
 * both local and remote updates appropriately.
 */
((request, args) => {
    const OWNER_DATA_KEY = "data_of_author"
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"
    
    // Parse and validate user data from request
    const user = JSON.parse(request["user"])

    try {
        // Initialize authentication and data access
        const authSid = lapi.BELoginAsAuthor()
        const userSid = lapi.MMOpen(authSid, user.mid, "cur")
        const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)    
        const nodeId = lapi.GetVar("", "hostid")
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

        // Validate that user exists in database
        if (!userInDB) {
            throw new Error("User not found in database")
        }

        // Check if the primary host ID has changed
        // This will throw an error if the new hostId is invalid
        if (user.hostIds && user.hostIds[0] && userInDB.hostIds && user.hostIds[0] !== userInDB.hostIds[0]) {
            // Make sure user mimei is available on the new hostId
            lapi.RunMApp("sync_user", {
                aid: APP_ID, 
                ver: "last",
                nid: user.hostIds[0], 
                sid: systemSid, 
                mid: user.mid
            }, [])
        }

        // Check if we need to delegate to the primary host
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            console.log("set_author_core_data local", JSON.stringify(user))
            
            // Delegate the update to the primary host
            const ret = lapi.RunMApp("set_author_core_data", {
                aid: APP_ID, 
                ver: "last",
                nid: user.hostIds[0], 
                sid: systemSid, 
                user: request["user"]
            }, [])
            
            console.log("set_author_core_data local ret=", JSON.stringify(ret))
            
            // Sync the updated data from the remote host. Assume the remote host is up to date.
            lapi.MiMeiSync(systemSid, "", user.mid, {})
            lapi.MiMeiProvide(systemSid, "", user.mid)
            
            // Get the updated user data from the locat host.
            const newUser = lapi.RunMApp("get_user_core_data", {
                aid: APP_ID, 
                ver: "last",
                userid: user.mid
            }, [])
            
            console.log("set_author_core_data local newUser=", JSON.stringify(newUser))
            return ret
        } else {
            // We are on the primary host, perform the update locally
            
            // If user update without providing hostIds, keep the old ones
            if (user.hostIds && user.hostIds.length > 0) {
                userInDB.hostIds = user.hostIds
            }
            
            // When user update without providing password, keep the old one
            if (user.password) {
                userInDB.password = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)
            }
            
            // Update user profile information
            userInDB.name = user.name
            userInDB.profile = user.profile

            // Save the updated user data
            lapi.Set(userSid, OWNER_DATA_KEY, userInDB)
            lapi.MMBackup(userSid, userInDB.mid, "", "delref=true")
            lapi.MiMeiProvide(authSid, "", userInDB.mid)
            
            // Update the user's score
            lapi.RunMApp("node_update_score", {
                aid: APP_ID, 
                ver: "last",
                userid: userInDB.mid, 
                mid: userInDB.mid
            }, [])

            // Remove password from response for security
            delete userInDB.password
            return {user: JSON.stringify(userInDB), status: "success"}
        }
    } catch(e) {
        console.error("Error set_auth_core_data", JSON.stringify(request), e)
        return {status: "failure", reason: "Update failed"}
    }
})(request, args)