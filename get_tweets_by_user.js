/**
 * Given user Id, get its tweets of the given range.
 */
((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const pageNum = parseInt(request["pn"], 10)
        const pageSize = parseInt(request["ps"], 10)
        const startRank = pageNum * pageSize
        const endRank = startRank + pageSize - 1
        const userId = request["userid"]
        const appUserId = request["appuserid"]
        const mmsid = lapi.MMOpen("", userId, "last")

        const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, startRank, endRank)
        let tweets = arr.map(sp => {
            const tweetId = sp.Member
            const tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: tweetId}, [])
            // if (!tweet) {
            //     return { tid: tweetId, tweet: null }
            // } else {
            //     return { tid: tweetId, tweet: tweet }
            // }
            if (!tweet) {
                console.log("get_tweets_by_user NULL", userId, tweetId)
            }
            return tweet
        })
        
        // Collect original tweets if originalTweetId is present
        let originalTweets = []
        tweets.forEach(tweet => {
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
        
        return {
            success: true,
            tweets: tweets,
            originalTweets: originalTweets
        }
    } catch(e) {
        console.error("Error get_tweets_by_user", JSON.stringify(request), e)
        return {
            success: false,
            error: e.message
        }
    }
})(request, args)