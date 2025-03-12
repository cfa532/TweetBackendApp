((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const authSid = lapi.BELoginAsAuthor()
        const userSid = lapi.MMOpen(authSid, request["userid"], "cur")
        const user = lapi.Get(userSid, OWNER_DATA_KEY)
        const nodeId = lapi.GetVar("", "hostid")
        const systemSid = lapi.BEOpenAppDataNode("cur", request["aid"])

        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            return lapi.RunMApp("set_user_avatar", {aid: request["aid"], ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: request["userid"], avatar: request["avatar"]}, []
            )
        } else {
            user["avatar"] = request["avatar"]
            lapi.Set(userSid, OWNER_DATA_KEY, user)
            lapi.MMBackup(userSid, user.mid, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", user.mid)

            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
                userid: user.mid, mid: user.mid}, [])
        }
    } catch(e) {
        console.error("Error set_user_avatar", JSON.stringify(request), e)
    }
})(request, args)