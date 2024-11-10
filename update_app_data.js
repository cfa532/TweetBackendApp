((request, args)=>{
    try {
        // update the App registry of User data when user is created or updated.
        const APPUSER_LIST = "app_user_list_key"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_MARK = "user registry"

        // update App data
        let user = JSON.parse(request["user"])
        let authSid = lapi.BELoginAsAuthor()
        let appsid = lapi.BEOpenAppDataNode("cur", APP_MARK)
        let appMid = lapi.GetVar("", "mmsid2mid", appsid)
        console.log("appsid", appsid, appMid)
        lapi.Hset(appsid, APPUSER_LIST, user.mid, user)
        lapi.MMBackup(authSid, appMid, "", "delref=true")
        console.log("App mid", appMid)
    } catch(e) {
        console.error("Error update_app_data", JSON.stringify(request), e)
    }
})(request, args)