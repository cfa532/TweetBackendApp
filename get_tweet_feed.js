((request, args)=>{
    try {
        // mid list of appUser's followings' tweets
        const FOLLOWINGS_TWEETS = "followings_tweets"
        const pageNum = parseInt(request["pn"], 10)
        const pageSize = parseInt(request["ps"], 10)
        const startRank = pageNum * pageSize
        const endRank = startRank + pageSize - 1
        const userId = request["userid"]
        const appUserId = request["appuserid"]  // app user who is accessing the tweets
        const mmsid = lapi.MMOpen("", userId, "last")
    
        /**
         * Given the rank, get the tweets of the followings
         */
        let arr = lapi.Zrevrange(mmsid, FOLLOWINGS_TWEETS, startRank, endRank)
        .map(sp => {
            const tweetId = sp.Member
            const tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: tweetId}, [])
            return tweet
        })
        
        // Collect original tweets if originalTweetId is present
        let originalTweets = []
        arr.forEach(tweet => {
            if (tweet && tweet.originalTweetId) {
                const originalTweet = lapi.RunMApp("get_tweet", {
                    aid: request["aid"], 
                    ver: "last",
                    appuserid: appUserId, 
                    tweetid: tweet.originalTweetId
                }, [])
                if (originalTweet) {
                    originalTweets.push(originalTweet)
                }
            }
        })
        
        // return all tweets, including null. Enable client to check the end of the feed.
        // .filter(e=> e)
        return {
            success: true,
            tweets: arr,
            originalTweets: originalTweets
        }
    } catch(e) {
        console.error("Error get_tweet_feed", JSON.stringify(request), e)
        return {
            success: false,
            error: e.message
        }
    }
})(request, args)