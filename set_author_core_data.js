/**
 * Update registered user data
 */
((request, args)=>{
    const OWNER_DATA_KEY = "data_of_author"
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"
    const user = JSON.parse(request["user"])

    try {
        const authSid = lapi.BELoginAsAuthor()
        const userSid = lapi.MMOpen(authSid, user.mid, "cur")
        let userInDB = lapi.Get(userSid, OWNER_DATA_KEY)    
        const nodeId = lapi.GetVar("", "hostid")
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        let isPublisher = true
        if (!userInDB) {
            isPublisher = false
            lapi.MiMeiSync(authSid, "", user.mid, {})
            userInDB = lapi.Get(userSid, OWNER_DATA_KEY)
            // lapi.MiMeiProvide(authSid, "", user.mid)
        }
        // If user has changed hostId, make sure user mimei is available on the new hostId.
        // The code below will throw an error if the new hostId is invalid.
        if (user.hostIds[0] != userInDB.hostIds[0]) {
            lapi.RunMApp("sync_user", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid, mid: user.mid}, []
            )
        }

        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            return lapi.RunMApp("set_author_core_data", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid, user: request["user"]}, []
            )
        } else {
            /**
             * If user update without providing hostIds, keep the old ones.
             */
            if (!user.hostIds || user.hostIds.length == 0) {
                user.hostIds = userInDB.hostIds
            }
            /**
             * When user update without providing password, keep the old one.
             */
            if (user.password) {
                user.password = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)
            } else {
                user.password = userInDB.password
            }

            lapi.Set(userSid, OWNER_DATA_KEY, user)
            lapi.MMBackup(userSid, user.mid, "", "delref=true")
            if (!isPublisher) {
                lapi.MiMeiProvide(authSid, "", user.mid)
            } else {
                lapi.MiMeiPublish(authSid, "", user.mid)
            }

            delete user.password
            return {user: JSON.stringify(user), status: "success"}
        }
    } catch(e) {
        console.error("Error set_auth_core_data", JSON.stringify(request), e)
        return {status: "failure", reason: "Update failed"}
    }
})(request, args)