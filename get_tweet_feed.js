((request, args)=>{
    try {
        // mid list of appUser's followings' tweets
        const FOLLOWINGS_TWEETS = "followings_tweets"
        const startRank = parseInt(request["start"], 10)
        const endRank = request["end"] = parseInt(request["end"], 10)
        const userId = request["userid"]
        const visitorId = request["gid"]  // app user who is accessing the tweets
        const mmsid = lapi.MMOpen("", userId, "last")
    
        /**
         * Given the rank, get the tweets of the followings
         */
        let arr = lapi.Zrevrange(mmsid, FOLLOWINGS_TWEETS, startRank, endRank)
        .map(sp => {
            const tweetId = sp.Member
            let tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                userid: visitorId, tweetid: tweetId}, [])
            if (!tweet) {
                // if tweet is not synced locally, try it again.
                console.log("get_tweet_feed: null tweetId", tweetId)
                const authSid = lapi.BELoginAsAuthor()
                try {
                    lapi.MiMeiSync(authSid, "", tweetId, {})
                    lapi.MiMeiProvide(authSid, "", tweetId)
                    tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                        userid: visitorId, tweetid: tweetId}, [])
                } catch(e) {
                    console.log("Error get_tweet_feed", JSON.stringify(request), e)
                }
            }
            return tweet
        }).filter(e=> e)
        return arr
    } catch(e) {
        console.error("Error get_tweet_feed", JSON.stringify(request), e)
    }
})(request, args)