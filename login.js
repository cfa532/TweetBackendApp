((request, args)=>{
    const APP_EXT = "com.example.twitterclone"
    const OWNER_DATA_KEY = "data_of_author"
    const APP_ID = request["aid"]
    let user = null

    try {
        const authSid = lapi.BELoginAsAuthor()
        const userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, request["username"], 2, 0x07276704)
        const userSid = lapi.MMOpen(authSid, userId, "cur")
        user = lapi.Get(userSid, OWNER_DATA_KEY)
        if (!user) {
            console.error("User does not exist.", request["username"])
            return {status: "failure", reason: "User does not exist"}
        }
        // return {user: JSON.stringify(user), status: "success"}

        // need to check hashed password
        if (user.password == lapi.MMCreate(authSid, APP_ID, APP_EXT, request["password"], 1, 0x07276704)) {
            // lapi.MiMeiSync(authSid, "", userId, {})
            // if enable Sync after login, remember to update hostIds of User data obj.
            let nodeId = lapi.GetVar("", "hostid")
            if (user.hostIds?.length > 0 && user.hostIds?.indexOf(nodeId) != 0) {
                // current node is not the writable host of the user data.
                // update last login time on the remost host.
                let systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
                lapi.RunMApp("update_login_time", {aid: APP_ID, ver: "last",
                    userid: userId, nid: user.hostIds[0], sid: systemSid}, []
                )
            } else {
                user["lastLogin"] = Date.now()
                lapi.Set(userSid, OWNER_DATA_KEY, user)
                lapi.MMBackup(authSid, user.mid, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", user.mid)
            }
            /**
             * Make sure to remove password from user data right before sending it back to client.
             */
            delete user.password
            return {user: JSON.stringify(user), status: "success"}
        } else {
            return {status: "failure", reason: "Wrong password"}
        }
    } catch(e) {
        console.error("Error login", JSON.stringify(request), e)
    }
})(request, args)