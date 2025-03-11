/**
 * Update registered user data
 */
((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"

        const user = JSON.parse(request["user"])
        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            return lapi.RunMApp("set_author_core_data", {aid: APP_ID, ver: "last",
                nid: author.hostIds[0], sid: systemSid,
                user: request["user"]}, []
            )
        } else {
            const authSid = lapi.BELoginAsAuthor()
            lapi.MiMeiSync(authSid, "", user.mid, {})   // make sure existing data is up to date.
            const userSid = lapi.MMOpen(authSid, user.mid, "cur")
            const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)    
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
            lapi.MiMeiPublish(userSid, "", user.mid)

            delete user.password
            return {user: JSON.stringify(user), status: "success"}
        }
    } catch(e) {
        console.error("Error set_auth_core_data", JSON.stringify(request), e)
        return {status: "failure", reason: "Update failed"}
    }
})(request, args)