((request, args)=>{
    try {
        const TOP_TWEETS = "top_tweet_list"
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        let topTweets = lapi.Get(mmsid, TOP_TWEETS)
        return topTweets
    } catch(e) {
        console.error("Error get_top_tweets:", JSON.stringify(request), e)
    }
})(request, args)