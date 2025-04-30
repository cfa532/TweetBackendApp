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
    const res = []
    try {
        const authSid = lapi.BELoginAsAuthor()
        const userSid = lapi.MMOpen(authSid, userId, "cur")
        const followings = lapi.Hkeys(userSid, FOLLOWINGS_LIST) // mid list of followings

        let followingsTweetsUpdated = false
        followings.forEach(uid => {
            console.log("check uid", uid)
            const mmsid = lapi.MMOpen("", uid, "last")  // each uid should have been synced locally.
            const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, 0, -1)
            for (const i in arr) {
                const element = arr[i]
                const tweetId = element.Member
                try {
                    lapi.Zscore(userSid, FOLLOWINGS_TWEETS, tweetId)    // Zscore will throw exception
                    break
                } catch(e) {
                    console.log("add new tweet", tweetId, e)
                    lapi.Zadd(userSid, FOLLOWINGS_TWEETS, element)
                    followingsTweetsUpdated = true
                    if (!lapi.MFIsExist("", tweetId)) {
                        lapi.MiMeiSync(userSid, "", tweetId, {})
                        lapi.MiMeiProvide(userSid, "", tweetId)

                        const tweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver:"last",
                            userid: userId, tweetid: tweetId}, [])
                        if (tweet)
                            res.push(tweet)
                    }
                }
            }
        })
        if (followingsTweetsUpdated) {
            lapi.MMBackup(authSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
        }
        return res
    } catch(e) {
        console.error("Error update_following_tweets", JSON.stringify(request), e)
    }
})(request, args)