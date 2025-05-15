((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const APP_ID = request["aid"]
        const userId = request["userid"]

        const authSid = lapi.BELoginAsAuthor()
        const userSid = lapi.MMOpen(authSid, userId, "cur")
        const user = lapi.Get(userSid, OWNER_DATA_KEY)

        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            return lapi.RunMApp("set_user_avatar", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId, avatar: request["avatar"]}, []
            )
        } else {
            user["avatar"] = request["avatar"]
            lapi.Set(userSid, OWNER_DATA_KEY, user)
            lapi.MMBackup(userSid, user.mid, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", user.mid)

            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: user.mid, mid: user.mid}, [])
        }
    } catch(e) {
        console.error("Error set_user_avatar", e, JSON.stringify(request))
    }
})(request, args)