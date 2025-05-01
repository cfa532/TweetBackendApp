/**
 * Check for new tweet of appUser's followings, and add them to
 * appUser's followings_tweets. If there is a new tweet, sync it and
 * return it to the appUser.
 */

((request, args)=>{
    const FOLLOWINGS_TWEETS = "followings_tweets"
    const FOLLOWINGS_LIST = "list_of_followings_mid"
    const TWT_LIST_KEY = "list_of_tweets_mid"
    const APP_ID = request["aid"]
    const userId = request["gid"]    // appUser
    const hostId = request["hostid"]
    const res = []
    try {
        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const arr = lapi.RunMApp("update_following_tweets", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                hostid: hostId, gid: userId}, []
            )
            console.log("new_tweets_followings remote", JSON.stringify(arr))
            return arr
        } else {
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            const followings = lapi.Hkeys(userSid, FOLLOWINGS_LIST) // mid list of followings
    
            let followingsTweetsUpdated = false
            const arr = followings.map(uid => {
                const mmsid = lapi.MMOpen("", uid, "last")  // each uid should have been synced locally.
                const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, 0, -1)
                for (const i in arr) {
                    const element = arr[i]
                    const tweetId = element.Member
                    try {
                        lapi.Zscore(userSid, FOLLOWINGS_TWEETS, tweetId)    // Zscore will throw exception
                        break   // the newest tweet of the user is in followings' tweet already. No new tweet.
                    } catch(e) {
                        console.log("update followings' new tweet", element.Member, e)
                        lapi.Zadd(userSid, FOLLOWINGS_TWEETS, element)
                        followingsTweetsUpdated = true

                        if (!lapi.MFIsExist("", tweetId)) {
                            lapi.MiMeiSync(userSid, "", tweetId, {})
                            lapi.MiMeiProvide(userSid, "", tweetId)
                        }
                        const tweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver:"last",
                            userid: userId, tweetid: tweetId}, [])
                        return tweet
                    }
                }
            })
            if (followingsTweetsUpdated) {
                lapi.MMBackup(authSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)
            }
            return arr.filter(e=> e)
        }
    } catch(e) {
        console.error("Error update_following_tweets", JSON.stringify(request), e)
    }
})(request, args)