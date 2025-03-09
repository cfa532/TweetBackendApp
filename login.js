((request, args)=>{
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const OWNER_DATA_KEY = "data_of_author"

        let authSid = lapi.BELoginAsAuthor()
        let userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, request["username"], 2, 0x07276704)
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)
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
                let req = {aid: APP_ID, ver: "last", userid: userId, 
                    nid: user.hostIds[0], sid: systemSid}
                lapi.RunMApp("update_login_time", req, [])
            } else {
                user["lastLogin"] = Date.now()
                lapi.Set(mmsid, OWNER_DATA_KEY, user)
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