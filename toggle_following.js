((request, args)=>{
    function toggleFollowing(
        userId, otherId
    ) {
        try {
            const FOLLOWINGS_LIST = "list_of_followings_mid"
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
    
            // check if the otherId is in the following list of the user
            const isFollowing = lapi.Hget(userSid, FOLLOWINGS_LIST, otherId)
            if (isFollowing) {
                lapi.Hdel(userSid, FOLLOWINGS_LIST, otherId)
            } else {
                lapi.Hset(userSid, FOLLOWINGS_LIST, otherId, Date.now())
            }
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
                userid: userId, mid: userId}, [])
            
            // return the updated following status on the otherid,
            return isFollowing ? false : true
        } catch(e) {
            console.error("Error toggle_followings", JSON.stringify(request), e)
        } 
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }

    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const userId = request["userid"]      // initiator of the follow or unfollow action
    const otherId = request["otherid"]     // userId to follow or unfollow
    const nodeId = lapi.GetVar("", "hostid")    // current node id
    const user = getUser(userId)

    if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
        // send the request to the remote host
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        const req = {aid: APP_ID, ver: "last", nid: user.hostIds[0], sid: systemSid,
            userid: userId, otherid: otherId}
        let ret = lapi.RunMApp("toggle_following", req, [])
        console.log("Toggle following remote ret", ret)
        return ret
    } else {
        let ret = toggleFollowing(userId, otherId)
        console.log("Toggle following ret", ret)
        return ret
    }
})(request, args)