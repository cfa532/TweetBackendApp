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