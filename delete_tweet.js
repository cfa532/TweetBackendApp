((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const TOP_TWEETS = "top_tweet_list"

        let tweetId = request["tweetid"]    // tweet Id to be removed
        let authorMid = request["authorid"]
        let authSid = lapi.BELoginAsAuthor()

        // if there is attachments, delete its reference.
        let mmsid = lapi.MMOpen(authSid, tweetId, "last")
        let tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
        tweet.attachments?.forEach(element => {
            lapi.MMDelRef(authSid, tweetId, element.mid)
        });

        mmsid = lapi.MMOpen(authSid, authorMid, "cur")
        lapi.Zrem(mmsid, TWT_LIST_KEY, tweetId)
        lapi.Hdel(mmsid, TOP_TWEETS, tweetId)   // remove it from pinned list
        lapi.MMBackup(authSid, authorMid, "", "delref=true")
        lapi.MMDelRef(authSid, authorMid, tweetId)

        lapi.MMDelVers(mmsid, tweetId)
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        console.log("Delete tweet ", JSON.stringify(tweet))
        lapi.MiMeiPublish(authSid, "", authorMid)
        return tweetId
    } catch(e) {
        console.error("Error delete_tweet:", JSON.stringify(request), e)
    }
})(request, args)