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
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
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
            if (tweet && tweet.authorId == userId) {
                tweet.attachments?.forEach(element => {
                    lapi.MMDelRef(tweetSid, tweetId, element.mid)
                });
                lapi.MMBackup(authSid, tweetId, "", "delref=true")
                lapi.MiMeiUnpublish(authSid, "", tweetId)
                lapi.MMDelVers(authSid, tweetId)
            }

            const userSid = lapi.MMOpen(authSid, userId, "cur")
            try {
                lapi.Zrem(userSid, TWT_LIST_KEY, tweetId)
                lapi.Zrem(userSid, FOLLOWINGS_TWEETS, tweetId)
                lapi.Hdel(userSid, PINNED_TWEETS, tweetId)   // remove it from pinned list
                lapi.MMDelRef(userSid, userId, tweetId)
                lapi.MMBackup(userSid, userId, "", "delref=true")
            } catch(e) {
                throw e
            }
            lapi.MiMeiPublish(authSid, "", userId)

            console.log("Delete tweet ", JSON.stringify(tweet), tweetId)
    
            // update the score of the tweet in AppData
            lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
                userid: userId, mid: tweetId}, [])
    
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