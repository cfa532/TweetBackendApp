((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const TOP_TWEETS = "top_tweet_list"

        let tweetId = request["tweetid"]    // tweet Id to be removed
        let userId = request["authorid"]
        let authSid = lapi.BELoginAsAuthor()

        // If there are attachments, delete all of the references.
        // If not referred, attachments will be deleted by garbage collector
        let mmsid = lapi.MMOpen(authSid, tweetId, "cur")
        let tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
        tweet.attachments?.forEach(element => {
            lapi.MMDelRef(authSid, tweetId, element.mid)
        });

        mmsid = lapi.MMOpen(authSid, userId, "cur")
        lapi.Zrem(mmsid, TWT_LIST_KEY, tweetId)
        lapi.Hdel(mmsid, TOP_TWEETS, tweetId)   // remove it from pinned list
        lapi.MMBackup(authSid, userId, "", "delref=true")

        lapi.MMDelRef(authSid, userId, tweetId)
        lapi.MiMeiUnpublish(authSid, "", tweetId)
        lapi.MMDelVers(mmsid, tweetId)
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        
        lapi.MiMeiPublish(authSid, "", userId)
        console.log("Delete tweet ", JSON.stringify(tweet))

        // update the score of the tweet in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: userId}, [])

        return tweetId
    } catch(e) {
        console.error("Error delete_tweet:", JSON.stringify(request), e)
    }
})(request, args)