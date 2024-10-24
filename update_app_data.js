((request, args)=>{
    try {
        // update the App registry of User data when user is created or updated.
        const APPUSER_LIST = "app_user_list_key"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_MARK = "Registered users on current node"
    
        // update App data
        let user = JSON.parse(request["user"])
        let authSid = lapi.BELoginAsAuthor()
        let appMid = lapi.MMGetAppDataID("", APP_ID, "app", "", APP_MARK, true)
        if (!appMid) {
            appMid = lapi.MMCreateAppData(authSid, APP_ID, "app", "", APP_MARK, 0x07276704)
            lapi.MiMeiPublish(authSid, "", appMid)
            console.log("appMid from update app,", appMid)
        }
        console.log("App mid", appMid, request["user"])

        let appsid = lapi.MMOpen(authSid, appMid, "cur")
        lapi.Hset(appsid, APPUSER_LIST, user.mid, user)
        lapi.MMBackup(authSid, appMid, "", "delref=true")
    } catch(e) {
        console.error(e)
    }
})(request, args)