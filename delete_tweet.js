((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const TWT_CONTENT_KEY = "core_data_of_tweet"

        let tweetId = request["tweetid"]    // tweet Id to be removed
        let authorMid = request["authorid"]
        let authSid = lapi.BELoginAsAuthor()

        // if there is attachments, delete its reference too.
        let mmsid = lapi.MMOpen(authSid, tweetId, "last")
        let tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
        tweet.attachments?.forEach(element => {
            lapi.MMDelRef(authSid, tweetId, element.mid)
        });

        mmsid = lapi.MMOpen(authSid, authorMid, "cur")
        lapi.Zrem(mmsid, TWT_LIST_KEY, tweetId)
        lapi.MMBackup(authSid, authorMid, "", "delref=true")
        lapi.MMDelRef(authSid, authorMid, tweetId)

        lapi.MMDelVers(mmsid, tweetId)
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        console.log("Delete tweet ", JSON.stringify(tweet))
        return tweetId
        // lapi.MiMeiPublish(authSid, "", authorMid)
    } catch(e) {
        console.error("delete_tweet:", JSON.stringify(request), e)
    }
})(request, args)