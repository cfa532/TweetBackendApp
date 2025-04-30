((request, args)=>{
    try {
        // mid list of appUser's tweets
        const TWT_LIST_KEY = "list_of_tweets_mid"

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
        let lastScore = Date.now()
        let arr = lapi.Zrevrange(mmsid, FOLLOWINGS_TWEETS, startRank, endRank)
        .map(sp => {
            let tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                userid: visitorId, tweetid: sp.Member}, [])
            if (!tweet) {
                //  if the tweet is not available locally, sync it.
                let authSid = lapi.BELoginAsAuthor()
                try {
                    lapi.MiMeiSync(authSid, "", sp.Member, {})
                    tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                        userid: visitorId, tweetid: sp.Member}, [])
                } catch(e) {
                    console.error("Error get_tweet_feed", sp.Member, e)
                }
            } else {
                if (tweet.timestamp < lastScore) {
                    lastScore = tweet.timestamp     // get the earliest (smallest) tweet's timestamp
                }
            }
            return tweet
        })

        /**
         * Retrieve the tweets of appUser during the same time span of the followings tweets
         */
        let selfTweets = lapi.Zrangebyscore(mmsid, TWT_LIST_KEY, lastScore, Date.now(), 0, 100)
        .map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                userid: visitorId, tweetid: sp.Member}, [])
        })
        if (selfTweets.length > 0) {
            arr = arr.concat(selfTweets)
        } else {
            // if there is no self tweets in the range, get a few anyway
            const ts = lapi.Zrevrange(mmsid, TWT_LIST_KEY, startRank, startRank+5)
            .map(sp => {
                return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                    userid: visitorId, tweetid: sp.Member}, [])
            })
            arr = arr.concat(ts)
        }
        return arr.filter(e=> e)
    } catch(e) {
        console.error("Error get_tweet_feed", JSON.stringify(request), e)
    }
})(request, args)