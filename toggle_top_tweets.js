((request, args)=>{
    try {
        const TOP_TWEETS = "top_tweet_list"
        const authSid = lapi.BELoginAsAuthor()
        let tweetId = request["tweetid"]
        let userId = request["userid"]
        let mmsid = lapi.MMOpen(authSid, userId, "cur")

        let topTweet = lapi.Hget(mmsid, TOP_TWEETS, tweetId)
        if (topTweet) {
            lapi.Hdel(mmsid, TOP_TWEETS, tweetId)
            console.log("Removed top tweet", tweetId)
        } else {
            lapi.Hset(mmsid, TOP_TWEETS, tweetId, Date.now())
            console.log("Add top tweet", tweetId)
        }
        lapi.MMBackup(authSid, userId, "", "delref=true")
        mmsid = lapi.MMOpen("", request["userid"], "last")
        let ts = lapi.Hkeys(mmsid, TOP_TWEETS)
        console.log("toggled pinned tweets", JSON.stringify(ts))
        return ts
    } catch(e) {
        console.error("Error toggle_top_tweets", JSON.stringify(request), e)
    } 
})(request, args)