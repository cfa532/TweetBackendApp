((request, args)=>{
    /////////////////////////////////////////////////////////////
    //  IMPORTANT: bool is passed as string "true/false"
    /////////////////////////////////////////////////////////////
    const isFollower = request["isfollower"]
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const userId = request["userid"]
    const otherId = request["otherid"]    // the follower whose status is toggled

    const nodeId = lapi.GetVar("", "hostid")    // current node id
    const user = getUser(userId)

    try {
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId, otherid: otherId, isfollower: isFollower}, [])
        } else {
            const FOLLOWERS_LIST = "list_of_followers_mid"
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
    
            if (isFollower == "true") {
                // otherId is a follower of userId
                lapi.Hset(userSid, FOLLOWERS_LIST, otherId, Date.now())
            } else {
                // otherId is NOT a follower of userId
                lapi.Hdel(userSid, FOLLOWERS_LIST, otherId)
            }
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: userId, mid: userId}, [])
            console.log(userId, "with follower", otherId, isFollower)
        }
    } catch(e) {
        console.error("Error toggle_follower", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)