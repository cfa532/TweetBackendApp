/**
 * This function toggles the following status of a user.
 * It first checks if the user is on the local node.
 * If not, it sends the request to the remote host.
 * If yes, it toggles the following status locally.
 * When following an user, copy its mids and sync all of its tweets locally.
 * When unfollowing, remove them. Do not add ref, so that Garbage collector
 * will remove unfollowed tweets.
 */

((request, args)=>{
    const FOLLOWINGS_TWEETS = "followings_tweets"
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
                // Unfollow the user and remove it tweets
                const ts = lapi.RunMApp("get_tweet_list", {aid: APP_ID, ver: "last", userid: otherId}, [])
                    .map(element => {
                        // lapi.MiMeiUnprovide(authSid, "", element.Member)
                        return element.Member
                    })
                // if (hostOfOtherId && hostOfOtherId != nodeId) {
                //     lapi.MiMeiUnprovide(authSid, "", otherId)
                //     lapi.MMDelVers(authSid, otherId)
                // }
                lapi.Zrem(userSid, FOLLOWINGS_TWEETS, ...ts)
                lapi.Hdel(userSid, FOLLOWINGS_LIST, otherId)
            } else {
                // Follow the otherId and provide for all of its tweet
                lapi.Hset(userSid, FOLLOWINGS_LIST, otherId, Date.now())
                if (hostOfOtherId && hostOfOtherId != nodeId) {
                    // lapi.MiMeiSync(authSid, "", otherId, {}) // throw error if otherId has one copy and on the same node
                    lapi.MiMeiProvide(authSid, "", otherId) // content of the otherId will be synced.
                }
                const ts = lapi.RunMApp("get_tweet_list", {aid: APP_ID, ver: "last", userid: otherId}, [])
                lapi.Zadd(userSid, FOLLOWINGS_TWEETS, ...ts)
                ts.forEach(element => {
                    lapi.MiMeiProvide(authSid, "", element.Member)
                })
            }
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver: "last",
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