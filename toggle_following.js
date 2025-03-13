/**
 * 
 * This function toggles the following status of a user.
 * It first checks if the user is on the local node.
 * If not, it sends the request to the remote host.
 * If yes, it toggles the following status locally.
 * 
 */
((request, args)=>{
    const APP_ID = request["aid"]
    const userId = request["userid"]      // initiator of the follow or unfollow action
    const otherId = request["otherid"]     // userId to follow or unfollow
    const hostOfOtherId = request["otherhostid"]    // host of the otherId.

    try {
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        const user = getUser(userId)

        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("toggle_following", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId, otherid: otherId, otherhostid: hostOfOtherId}, []
            )
            console.log("Toggle following remote", ret, userId, otherId, hostOfOtherId, nodeId)
            return ret
        } else {
            const FOLLOWINGS_LIST = "list_of_followings_mid"
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
    
            // check if the otherId is in the following list of the user
            const isFollowing = lapi.Hget(userSid, FOLLOWINGS_LIST, otherId) ? true : false
            if (isFollowing) {
                lapi.Hdel(userSid, FOLLOWINGS_LIST, otherId)
                if (hostOfOtherId && hostOfOtherId != nodeId) {
                    lapi.MiMeiUnprovide(authSid, "", otherId)
                    lapi.MMDelVers(authSid, otherId)
                }
            } else {
                lapi.Hset(userSid, FOLLOWINGS_LIST, otherId, Date.now())
                if (hostOfOtherId && hostOfOtherId != nodeId) {
                    lapi.MiMeiSync(authSid, "", otherId, {})
                    lapi.MiMeiProvide(authSid, "", otherId)
                }
            }
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: userId, mid: userId}, [])
            
            // return the updated following status on the otherid,
            console.log("Toggle following", !isFollowing, userId, otherId, hostOfOtherId, nodeId)
            return !isFollowing
        }
    } catch(e) {
        console.error("Error toggle_followings", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)