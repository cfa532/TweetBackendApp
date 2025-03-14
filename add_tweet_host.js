// ((request, args)=>{
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const TWT_LIST_KEY = "list_of_tweets_mid"

        const tweet = JSON.parse(request['tweet'])
        const authSid = lapi.BELoginAsAuthor()
        const tweetId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
        tweet["mid"] = tweetId
        tweet["timestamp"] = Date.now()

        const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
        lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)

        tweet.attachments?.forEach(element => {
            lapi.MMAddRef(tweetSid, tweetId, element.mid)
        });
        lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(tweetSid, "", tweetId)     // publish the tweet ID.

        const authorId = tweet.authorId
        const userSid = lapi.MMOpen(authSid, authorId, "cur")
        lapi.Zadd(userSid, TWT_LIST_KEY, getScorePair(tweetId))

        lapi.MMAddRef(userSid, authorId, tweetId)
        lapi.MMBackup(userSid, authorId, "", "delref=true")
        lapi.MiMeiPublish(userSid, "", authorId)

        // update the score of the new tweet in AppData
        lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
            userid: tweet.authorId, mid: tweet.mid}, [])
        JSON.stringify(tweet)
    } catch(e) {
        console.error("Error add_tweet_host", JSON.stringify(request), e)
    }

    function getScorePair(mid) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = Date.now()
        sp.Member = mid
        return sp
    }
// })(request, args)
