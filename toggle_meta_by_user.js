((request, args)=>{
    try {
        const APP_ID = request["aid"]
        const userId = request["userid"]
        const hostId = request["hostid"]

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const req = {aid: APP_ID, ver: "last", nid: hostId, sid: systemSid,
                userid: userId, mid: request["mid"], type: request["type"]}
            let ret = lapi.RunMApp("toggle_meta_by_user_host", req, [])
            lapi.MiMeiSync(systemSid, "", request["mid"], {})
            return ret
        } else {
            const req = {aid: APP_ID, ver: "last",
                userid: userId, mid: request["mid"], type: request["type"]}
            return lapi.RunMApp("toggle_meta_by_user_host", req, [])
        }

    } catch(e) {
        console.error("Error toggle_meta_by_user", JSON.stringify(request), e)
    }
})(request, args)