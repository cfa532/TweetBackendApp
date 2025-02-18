((request, args)=>{
    // let ScorePair = new Function('score', 'member', 'return {score, member}')
    // request, lapi are global variables.
    // each comment is also tweet object.
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const TWT_LIST_KEY = "list_of_tweets_mid"

        let tweet = JSON.parse(request["tweet"])
        let authSid = lapi.BELoginAsAuthor()
        let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
        tweet["mid"] = mid

        let mmsid = lapi.MMOpen(authSid, mid, "cur")
        tweet["timestamp"] = Date.now()
        lapi.Set(mmsid, TWT_CONTENT_KEY, tweet)

        tweet.attachments?.forEach(element => {
            lapi.MMAddRef(authSid, mid, element.mid)
        });

        lapi.MMBackup(authSid, mid, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", mid)     // publish the tweet ID.

        // only add the tweet in author's tweet list if it is not comment only.
        // otherwise only show the comment under the original tweet
        let authorId = tweet["authorId"]
        mmsid = lapi.MMOpen(authSid, authorId, "cur")
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = Date.now()
        sp.Member = mid
        lapi.Zadd(mmsid, TWT_LIST_KEY, sp)
        lapi.MMAddRef(authSid, authorId, mid)
        lapi.MMBackup(authSid, authorId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", authorId)
        return mid
    } catch(e) {
        console.error("Error upload_tweet:", JSON.stringify(request), e)
    }
})(request, args)
