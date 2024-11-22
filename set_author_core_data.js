((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const authSid = lapi.BELoginAsAuthor()

        let user = JSON.parse(request["user"])
        user.password = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)

        let mmsid = lapi.MMOpen(authSid, user.mid, "cur")
        lapi.Set(mmsid, OWNER_DATA_KEY, user)
        lapi.MMBackup(authSid, user.mid, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", user.mid)

        // lapi.RunMApp("update_app_data", {aid: request["aid"], ver: "last", user: JSON.stringify(user)}, [])
        console.log("set userdata", JSON.stringify(user))
        delete user.password
        return {user: JSON.stringify(user), status: "success"}
    } catch(e) {
        console.error("Error set_auth_core_data", JSON.stringify(request), e)
        return {status: "failure", reason: "Update failed"}
    }
})(request, args)