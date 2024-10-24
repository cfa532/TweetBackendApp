((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        let user = JSON.parse(request["user"])
        const authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, user.mid, "cur")
        lapi.Set(mmsid, OWNER_DATA_KEY, user)
        lapi.MMBackup(authSid, user.mid, "", "delref=true")
        // lapi.MiMeiPublish(authSid, "", user.mid)

        lapi.RunMApp("update_app_data", {aid: request["aid"], ver: "last", user: JSON.stringify(user)}, [])
        console.log("set userdata", request["user"])
        delete user.password
        return user
    } catch(e) {
        console.error(e)
    }
})(request, args)