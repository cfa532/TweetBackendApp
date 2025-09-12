((request, args)=>{
    const APP_EXT = "com.example.twitterclone"
    const OWNER_DATA_KEY = "data_of_author"
    const APP_ID = request["aid"]
    const username = request["username"]
    const password = request["password"]
    const authSid = lapi.BELoginAsAuthor()
    const userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, username, 2, 0x07276704)
    const userSid = lapi.MMOpen(authSid, userId, "cur")
    const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)

    let loginOK = false
    // delete userInDB.password
    // return {user: userInDB, status: "success"}
    try {

        // need to check hashed password
        if (userInDB.password == lapi.MMCreate(authSid, APP_ID, APP_EXT, password, 1, 0x07276704)) {
            // login success
            loginOK = true
            // update last login time
            let nodeId = lapi.GetVar("", "hostid")
            if (userInDB.hostIds?.length > 0 && userInDB.hostIds?.indexOf(nodeId) != 0) {
                // current node is not the writable host of the user data.
                // update last login time on the remost host.
                let systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
                return lapi.RunMApp("login", {aid: APP_ID, ver: "last",
                    nid: userInDB.hostIds[0], sid: systemSid,
                    username: username, password: password,
                }, [])
            } else {
                userInDB["lastLogin"] = Date.now()
                
                // Check and validate user timestamp - must be in the past and not more than 2 years old
                const currentTime = userInDB["lastLogin"]
                const twoYearsAgo = currentTime - (2 * 365 * 24 * 60 * 60 * 1000) // 2 years in milliseconds
                
                if (!userInDB.timestamp || 
                    typeof userInDB.timestamp !== 'number' || 
                    userInDB.timestamp <= 0 || 
                    userInDB.timestamp > currentTime || 
                    userInDB.timestamp < twoYearsAgo) {
                    userInDB.timestamp = currentTime
                }
                
                lapi.Set(userSid, OWNER_DATA_KEY, userInDB)
                lapi.MMBackup(authSid, userInDB.mid, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userInDB.mid)

                /**
                 * Make sure to remove password from user data right before sending it back to client.
                 */
                delete userInDB.password
                return {user: userInDB, status: "success"}
            }
        } else {
            return {status: "failure", reason: "Wrong password"}
        }
    } catch(e) {
        console.error("Error login", loginOK, JSON.stringify(request), e)
        if (loginOK) {
            delete userInDB.password
            return {user: userInDB, status: "success"}
        }
        else
            return {status: "failure", reason: "Unknown error"}
    }
})(request, args)