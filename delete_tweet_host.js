// ((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const PINNED_TWEETS = "top_tweet_list"
        const tweetId = request["tweetid"]    // tweet Id to be removed
        const userId = request["authorid"]
        const authSid = lapi.BELoginAsAuthor()

        // If there are attachments, delete all of the references.
        // If not referred, attachments will be deleted by garbage collector
        const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
        const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
        tweet.attachments?.forEach(element => {
            lapi.MMDelRef(tweetSid, tweetId, element.mid)
        });
        lapi.MMDelVers(tweetSid, tweetId)

        const userSid = lapi.MMOpen(authSid, userId, "cur")
        lapi.Zrem(userSid, TWT_LIST_KEY, tweetId)
        lapi.Hdel(userSid, PINNED_TWEETS, tweetId)   // remove it from pinned list
        lapi.MMBackup(userSid, userId, "", "delref=true")

        lapi.MMDelRef(userSid, userId, tweetId)
        lapi.MiMeiUnpublish(userSid, "", tweetId)
        lapi.MMBackup(userSid, tweetId, "", "delref=true")
        
        lapi.MiMeiPublish(userSid, "", userId)
        console.log("Delete tweet ", JSON.stringify(tweet))

        // update the score of the tweet in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: userId}, [])

        tweetId
    } catch(e) {
        console.error("Error delete_tweet_host", JSON.stringify(request), e)
    }
// })(request, args)