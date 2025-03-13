// ((request, args)=>{
    function getScorePair(mid) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = Date.now()
        sp.Member = mid
        return sp
    }

    // let ScorePair = new Function('score', 'member', 'return {score, member}')
    // request, lapi are global variables.
    // each comment is also tweet object.
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const TWT_LIST_KEY = "list_of_tweets_mid"

        let tweet = JSON.parse(request['tweet'])
        let authSid = lapi.BELoginAsAuthor()
        let tweetId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
        tweet["mid"] = tweetId

        let tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
        lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)

        tweet.attachments?.forEach(element => {
            lapi.MMAddRef(tweetSid, tweetId, element.mid)
        });
        lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(tweetSid, "", tweetId)     // publish the tweet ID.

        let authorId = tweet["authorId"]
        let userSid = lapi.MMOpen(authSid, authorId, "cur")
        lapi.Zadd(userSid, TWT_LIST_KEY, getScorePair(tweetId))
        lapi.MMAddRef(userSid, authorId, tweetId)
        lapi.MMBackup(userSid, authorId, "", "delref=true")
        lapi.MiMeiPublish(userSid, "", authorId)

        // Now sync the original tweet to the current node
        if (tweet.originalTweetId) {
            lapi.MiMeiSync(authSid, "", tweet.originalTweetId, {})
            lapi.MiMeiProvide(authSid, "", tweet.originalTweetId)
        }

        // update the score of the user in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: tweet.authorId, mid: tweet.authorId}, [])
        tweetId
    } catch(e) {
        console.error("Error add_tweet_host", JSON.stringify(request), e)
    }
// })(request, args)
