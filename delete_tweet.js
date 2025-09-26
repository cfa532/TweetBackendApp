((request, args)=>{
    const TWT_LIST_KEY = "list_of_tweets_mid"
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const FOLLOWINGS_TWEETS = "followings_tweets"
    const PINNED_TWEETS = "pinned_tweet_list"
    const tweetId = request["tweetid"]    // tweet Id to be removed
    const userId = request["userid"]
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication

    try {
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("delete_tweet", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                tweetid: tweetId, userid: userId}, []
            )
            console.log("delete_tweet: remote ret=", JSON.stringify(ret))
            return ret
        } else {
            // If there are attachments, delete all of the references.
            // If not referred, attachments will be deleted by garbage collector
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
            console.log("delete_tweet: tweet=", JSON.stringify(tweet))

            // only the author of the tweet can delete it.
            // the others only remove the mid from its tweet list.
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            if (tweet && tweet.authorId == userId) {
                tweet.attachments?.forEach(element => {
                    lapi.MMDelRef(tweetSid, tweetId, element.mid)
                });
                lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
                lapi.MiMeiUnpublish(tweetSid, "", tweetId)
                lapi.MMDelVers(tweetSid, tweetId)

                if (tweet.originalTweetId) {
                    lapi.MMDelRef(userSid, userId, tweet.originalTweetId)
                }
                lapi.MMDelRef(userSid, userId, tweetId)
            }

            lapi.Zrem(userSid, TWT_LIST_KEY, tweetId)
            lapi.Zrem(userSid, FOLLOWINGS_TWEETS, tweetId)
            lapi.Hdel(userSid, PINNED_TWEETS, tweetId)   // remove it from pinned list
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)

            console.log("Delete tweet ", JSON.stringify(tweet), tweetId)
    
            // update the score of the author in AppData
            lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
                userid: userId, mid: userId}, [])
    
            return {tweetid: tweetId, success: true}
        }
    } catch(e) {
        console.error("Error delete_tweet:", e, JSON.stringify(request))
        return {message: e, success: false}
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)