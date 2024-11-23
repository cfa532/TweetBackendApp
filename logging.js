((request, args)=>{
    // request, lapi are global variables
    try {
        const APP_MARK = "Registered users on current node"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const msg = JSON.parse(request["msg"])
        console.warn("Timber.log:", request["msg"])

        let authSid = lapi.BELoginAsAuthor()
        let appMid = lapi.MMGetAppDataID("", APP_ID, "app", "", APP_MARK, true)
        if (!appMid) {
            appMid = lapi.MMCreateAppData(authSid, APP_ID, "app", "", APP_MARK, 0x07276704)
            console.log("appMid from logging,", appMid)
        }
        let appsid = lapi.MMOpen(authSid, appMid, "cur")
        lapi.Hset(appsid, "timber_logs", Date.now().toString(), msg)
        lapi.MMBackup(authSid, appMid, "", "delref=true")
    } catch(e) {
        console.error("Error logging", JSON.stringify(request), e)
    }
})(request, args)