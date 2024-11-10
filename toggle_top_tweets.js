((request, args)=>{
    try {
        const TOP_TWEETS = "top_tweet_list"
        const authSid = lapi.BELoginAsAuthor()
        let tweetId = request["tweetid"]
        let userId = request["userid"]
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        let topTweets = lapi.Get(mmsid, TOP_TWEETS)
        if (topTweets) {
            let idx = topTweets.findIndex(i=> i==tweetId)
            if ( idx > -1)
                topTweets.splice(idx, 1)
            else
                topTweets.unshift(tweetId)
        } else {
            topTweets = [tweetId]
        }
        lapi.Set(mmsid, TOP_TWEETS, topTweets)
        lapi.MMBackup(authSid, userId, "", "delref=true")
        console.log("toggle top tweets", JSON.stringify(topTweets))
        return topTweets
    } catch(e) {
        console.error("Error toggle_top_tweets", JSON.stringify(request), e)
    } 
})(request, args)