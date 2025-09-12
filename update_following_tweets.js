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
    const userSid = lapi.MMOpen(authSid, userId, "cur")

    try {
        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            lapi.RunMApp("update_following_tweets", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                hostid: hostId, appuserid: userId}, []
            )

            // update the followings_tweets of the appUser on current node
            const tweets = []
            const arr = lapi.Zrevrange(userSid, FOLLOWINGS_TWEETS, 0, -1)
            for (const e of arr) {
                const tweetId = e.Member
                let tweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver:"last",
                    appuserid: userId, tweetid: tweetId}, [])
                if (!tweet) {
                    console.log("update_following_tweets: sync tweet", tweetId)
                    try {
                        lapi.MiMeiSync(userSid, "", tweetId, {})
                        // lapi.MiMeiProvide(userSid, "", tweetId)
                        tweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver:"last",
                            appuserid: userId, tweetid: tweetId}, [])
                        if (tweet) {
                            tweets.push(tweet)
                        }
                    } catch(e) {
                        console.error("Error update_following_tweets: sync tweet", e, tweetId)
                    }
                } else {
                    break
                }
            }
            lapi.MMBackup(userSid, userId, "", "delref=true")
            return {
                success: true,
                tweets: tweets,
                originalTweets: []
            }
        } else {
            const followings = lapi.Hkeys(userSid, FOLLOWINGS_LIST) // mid list of its followings
            console.log("update_following_tweets followings", JSON.stringify(followings))

            let followingsTweetsUpdated = false
            const tweets = []
            for (const uid of followings) {
                try {
                    const mmsid = lapi.MMOpen("", uid, "last")  // every following's id should have been synced locally.
                    const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, 0, -1)
                    for (const e of arr) {
                        const tweetId = e.Member
                        const rank = lapi.Zrank(userSid, FOLLOWINGS_TWEETS, tweetId)
                        if (rank > -1) {
                            break   // the newest tweet of the user is in followings' tweet already. No new tweet.
                        } else {
                            lapi.Zadd(userSid, FOLLOWINGS_TWEETS, e)
                            followingsTweetsUpdated = true

                            lapi.MiMeiSync(userSid, "", tweetId, {})
                            lapi.MiMeiProvide(userSid, "", tweetId)

                            const tweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver:"last",
                                appuserid: userId, tweetid: tweetId}, [])
                            console.log("update followings' new tweet", tweetId, userId)
                            tweets.push(tweet)
                        }
                    }
                } catch(e) {
                    console.error("Error update_following_tweets", e, uid)
                }
            }
            
            if (followingsTweetsUpdated) {
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
        console.error("Error update_following_tweets", e, JSON.stringify(request))
        return {
            success: false,
            error: e.message
        }
    }
})(request, args)