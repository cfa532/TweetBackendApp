((request, args)=>{
    const TOP_TWEETS = "top_tweet_list"
    let userId = request["userid"]
    let mmsid = lapi.MMOpen("", userId, "last")
    let topTweets = lapi.Get(mmsid, TOP_TWEETS)

    console.log("get top tweets", JSON.stringify(topTweets))
    return topTweets

})(request, args)