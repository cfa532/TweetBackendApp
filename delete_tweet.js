((request, args)=>{
    const TWT_LIST_KEY = "list_of_tweets_mid"
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const PINNED_TWEETS = "top_tweet_list"
    const tweetId = request["tweetid"]    // tweet Id to be removed
    const userId = request["authorid"]
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication

    try {
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("delete_tweet", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                tweetid: tweetId, authorid: userId}, []
            )
            return ret
        } else {
            // If there are attachments, delete all of the references.
            // If not referred, attachments will be deleted by garbage collector
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
            if (tweet) {
                tweet.attachments?.forEach(element => {
                    lapi.MMDelRef(tweetSid, tweetId, element.mid)
                });
                lapi.MMBackup(authSid, tweetId, "", "delref=true")
                lapi.MiMeiUnpublish(authSid, "", tweetId)
                lapi.MMDelVers(authSid, tweetId)
            }

            const userSid = lapi.MMOpen(authSid, userId, "cur")
            lapi.Zrem(userSid, TWT_LIST_KEY, tweetId)
            lapi.Hdel(userSid, PINNED_TWEETS, tweetId)   // remove it from pinned list
            lapi.MMDelRef(userSid, userId, tweetId)
            lapi.MMBackup(authSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)

            console.log("Delete tweet ", JSON.stringify(tweet))
    
            // update the score of the tweet in AppData
            lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
                userid: userId, mid: tweetId}, [])
    
            return tweetId
        }
    } catch(e) {
        console.error("Error delete_tweet", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)