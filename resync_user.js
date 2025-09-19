/**
 * Different from get_user, this function makes sure the current node is up to date.
 * It syncs the user from the its host, and its tweets will be updated by system.
 */
((request, args)=>{
    const userId = request["userid"]
    const user = getUser(userId)

    try {
        const nodeId = lapi.GetVar("", "hostid")
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // make sure the current user is up to date.
            lapi.RunMApp("node_update_mid_by_score", {aid: request["aid"], ver:"last",
                hostid: hostId, userid: userId, mid: userId}, [])
        }
        return lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last",
            userid: userId}, [])
    } catch(e) {
        console.error("Error resync_user", e, JSON.stringify(request))
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)