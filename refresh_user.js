/**
 * Different from get_user, this function makes sure the current node is up to date.
 * It syncs the user from the its host, and its tweets will be updated by system.
 */
((request, args)=>{
    const userId = request["userid"]
    const hostId = request["hostid"]  // main host of the user

    try {
        const nodeId = lapi.GetVar("", "hostid")
        if (nodeId !== hostId) {
            // make sure the current node is up to date.
            lapi.RunMApp("node_update_mid_by_score", {aid: request["aid"], ver:"last",
                hostid: hostId, userid: userId, mid: userId}, [])
        }
        return lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last",
            userid: userId}, [])
    } catch(e) {
        console.error("Error refresh_user", e, JSON.stringify(request))
    }
})(request, args)