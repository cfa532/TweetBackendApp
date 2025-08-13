/**
 * This function toggles the following status of a user.
 * It first checks if the user is on the local node.
 * If yes, it toggles the following status locally.
 * If not, it sends the request to the remote host.
 * When following an user, copy its mids and sync all of its tweets locally.
 * When unfollowing, remove its tweets' mid and ref, and Garbage collector
 * will remove unfollowed tweets.
 */

((request, args)=>{
    const FOLLOWINGS_TWEETS = "followings_tweets"
    const FOLLOWINGS_LIST = "list_of_followings_mid"
    const APP_ID = request["aid"]
    const userId = request["userid"]      // initiator of the follow or unfollow action
    const followedId = request["followingid"]     // userId to follow or unfollow

    try {
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        const user = getUser(userId)
        // const provs = lapi.MiMeiFindProvs(systemSid, "", userId, 3)

        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            let ret = lapi.RunMApp("toggle_following", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId, otherid: followedId}, []
            )
            console.log("Toggle following remote", ret, userId, followedId, nodeId)
            return ret
        } else {
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")

            // temp solution to check if the otherId is provided by current node.
            // const providers = lapi.MiMeiFindProvs(authSid, "", otherId, 3)
            // console.log("Find providers", JSON.stringify(providers), otherId)
            let followedUser = getUser(followedId)
            if (!followedUser) {
                // the other is not provided by current node.
                lapi.MiMeiSync(authSid, "", followedId, {})
                followedUser = getUser(followedId)
            }
            console.log("followingUser", JSON.stringify(followedUser))
            const hostOfOther = followedUser.hostIds[0]

            // check if the otherId is in the following list of the user
            const isFollowing = lapi.Hget(userSid, FOLLOWINGS_LIST, followedId) ? true : false
            if (isFollowing) {
                console.log(userId, "unfollowing", followedId, hostOfOther, nodeId)
                // Unfollow the user and remove it tweets
                const midList = lapi.RunMApp("get_tweet_id_list", {aid: APP_ID, ver: "last", userid: followedId}, []).map(e => e.Member)

                lapi.Zrem(userSid, FOLLOWINGS_TWEETS, ...midList)
                lapi.Hdel(userSid, FOLLOWINGS_LIST, followedId)
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)

                lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                    nid: hostOfOther, sid: systemSid,
                    userid: followedId, otherid: userId, isfollower: false
                }, [])
                // Do not do it yet
                // if (hostOfOtherId != nodeId) {
                //     lapi.MiMeiUnprovide(authSid, "", otherId)
                // }
            } else {
                console.log(userId, "following", followedId, hostOfOther, nodeId)
                // Follow the otherId and provide for all of its tweet
                lapi.Hset(userSid, FOLLOWINGS_LIST, followedId, Date.now())

                const scorepairs = lapi.RunMApp("get_tweet_id_list", {aid: APP_ID, ver: "last",
                    nid: hostOfOther, sid: systemSid, userid: followedId
                }, [])
                console.log("Following List", JSON.stringify(scorepairs), followedId, hostOfOther)
                lapi.Zadd(userSid, FOLLOWINGS_TWEETS, ...scorepairs)
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)

                lapi.MiMeiProvide(authSid, "", followedId) // content of the otherId will be synced.
                lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                    nid: hostOfOther, sid: systemSid,
                    userid: followedId, otherid: userId, isfollower: true
                }, [])
            }
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver: "last",
                userid: userId, mid: userId}, [])
            
            // return the updated following status on the otherid,
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