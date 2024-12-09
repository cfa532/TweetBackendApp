((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, request["userid"], "cur")
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)
        user["avatar"] = request["avatar"]
        lapi.Set(mmsid, OWNER_DATA_KEY, user)
        lapi.MMBackup(authSid, user.mid, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", user.mid)

        lapi.RunMApp("update_app_data", {aid: request["aid"], ver: "last", user: JSON.stringify(user)}, [])
        console.log("set user avatar", JSON.stringify(user))
    } catch(e) {
        console.error("Error set_user_avatar", JSON.stringify(request), e)
    }
})(request, args)