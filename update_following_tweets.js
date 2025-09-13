/**
 * Check for new tweet of appUser's followings, and add them to
 * appUser's followings_tweets. If there is a new tweet, sync it and
 * return it to the appUser.
 */

((request, args)=>{
    const FOLLOWINGS_TWEETS = "followings_tweets"   // sorted set of followings' tweets
    const FOLLOWINGS_LIST = "list_of_followings_mid"
    const TWT_LIST_KEY = "list_of_tweets_mid"   // sorted set of user's own tweets
    const APP_ID = request["aid"]
    const userId = request["appuserid"]    // appUser
    const hostId = request["hostid"]
    const authSid = lapi.BELoginAsAuthor()
    const nodeId = lapi.GetVar("", "hostid")    // current node id

    try {
        const userSid = lapi.MMOpen(authSid, userId, "cur")
        const lastElements = lapi.Zrevrange(userSid, FOLLOWINGS_TWEETS, 0, 0)
        const lastScore = lastElements.length > 0 ? lastElements[0].Score : 0
        const tweets = []

        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            lapi.RunMApp("update_following_tweets", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                hostid: hostId, appuserid: userId}, []
            )

            lapi.MiMeiSync(userSid, "", userId, {})
            const arr = lapi.Zrangebyscore(userSid, FOLLOWINGS_TWEETS, lastScore, -1, 0, 1000)
            
            for (const e of arr) {
                const tweetId = e.Member
                const tweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver:"last",
                    appuserid: userId, tweetid: tweetId}, [])
                if (tweet) {
                    tweets.push(tweet)
                }
            }
            lapi.MMBackup(userSid, userId, "", "delref=true")
            return {
                success: true,
                tweets: tweets,
                originalTweets: []
            }
        } else {
            // remote host
            const followings = lapi.Hkeys(userSid, FOLLOWINGS_LIST) // mid list of its followings
            console.log("update_following_tweets followings", JSON.stringify(followings))

            for (const uid of followings) {
                tweets.push(...updateUser(uid, lastScore, userSid))     // sync followings' data if there is any new tweet.
            }
        
            if (tweets.length > 0) {
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(userSid, "", userId)
            }
            return {
                success: true,
                tweets: tweets,
                originalTweets: []
            }
        }
    } catch(e) {
        console.error("Error update_following_tweets:", e, JSON.stringify(request))
        return {
            success: false,
            error: e.message
        }
    }

    function updateUser(uid, lastScore, userSid) {
        try {
            const OWNER_DATA_KEY = "data_of_author"
            const mmsid = lapi.MMOpen("", uid, "last")
            const user = lapi.Get(mmsid, OWNER_DATA_KEY)
            if (!user) {
                console.error("Error update_following_tweets: updateUser: user not found", uid, nodeId)
                return []
            }
            if (user.hostIds && user.hostIds.length > 0) {
                lapi.RunMApp("node_update_mid_by_score", {aid: APP_ID, ver:"last",
                    hostid: user.hostIds[0], userid: uid, mid: uid}, [])
            }

            const arr = lapi.Zrangebyscore(mmsid, TWT_LIST_KEY, lastScore, -1, 0, 1000)
            if (arr.length > 0) {
                lapi.Zadd(userSid, FOLLOWINGS_TWEETS, ...arr)
            }
            const tweets = []
            for (const e of arr) {
                const tweetId = e.Member
                const tweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver:"last",
                    appuserid: userId, tweetid: tweetId}, [])
                if (tweet) {
                    console.log("update followings' new tweet", tweetId, userId)
                    tweets.push(tweet)
                }
            }
            return tweets
        } catch(e) {
            console.error("Error update_following_tweets: updateUser", e, uid)
            return []
        }
    }
})(request, args)