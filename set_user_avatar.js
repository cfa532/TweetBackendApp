((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const APP_ID = request["aid"]
        const userId = request["userid"]

        const authSid = lapi.BELoginAsAuthor()
        const userSid = lapi.MMOpen(authSid, userId, "cur")
        const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)

        const nodeId = lapi.GetVar("", "hostid")
        if (!userInDB.hostIds || userInDB.hostIds.length === 0 || userInDB.hostIds[0] !== nodeId) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            return lapi.RunMApp("set_user_avatar", {aid: APP_ID, ver: "last",
                nid: userInDB.hostIds[0], sid: systemSid,
                userid: userId, avatar: request["avatar"]}, []
            )
        } else {
            userInDB["avatar"] = request["avatar"]
            lapi.Set(userSid, OWNER_DATA_KEY, userInDB)
            lapi.MMBackup(userSid, userInDB.mid, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userInDB.mid)

            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: userInDB.mid, mid: userInDB.mid}, [])
            return request["avatar"]
        }
    } catch(e) {
        console.error("Error set_user_avatar", e, JSON.stringify(request))
    }
})(request, args)