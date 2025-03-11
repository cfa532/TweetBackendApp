((request, args)=>{
    const APP_MARK = "Registered users on current node"
    const APP_ID = request["aid"]
    const msg = request["msg"]
    const hostId = request["hostid"]
    const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
    try {
        const nodeId = lapi.GetVar("", "hostid")
        if (hostId != nodeId) {
            // the node is not host of appUser
            lapi.RunMApp("logging", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                msg: msg, hostid: hostId
            })
        } else {
            console.log(msg)
            logging()
        }
    } catch(e) {
        console.error("Error logging", JSON.stringify(request), e)
    }

    function logging() {
        try {
            const appMid = lapi.MMCreateAppData(systemSid, APP_ID, "app", "", APP_MARK, 0x07276704)
            const appsid = lapi.MMOpen(systemSid, appMid, "cur")
            lapi.Hset(appsid, "timber_logs", Date.now().toString(), msg)
            lapi.MMBackup(authSid, appMid, "", "delref=true")
        } catch(e) {
            console.error("Error logging", JSON.stringify(request), e)
        }
    
    }
})(request, args)