((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const FOLLOWINGS_TWEETS = "followings_tweets"

        const startRank = parseInt(request["start"], 10)
        const endRank = request["end"] = parseInt(request["end"], 10)
        const userId = request["userid"]
        const visitorId = request["gid"]  // app user who is accessing the tweets
        const mmsid = lapi.MMOpen("", userId, "last")
    
        let lastScore = Date.now()
        /**
         * Given the rank, get the tweets of the followings
         */
        let arr = lapi.Zrevrange(mmsid, FOLLOWINGS_TWEETS, startRank, endRank)
        .map(sp => {
            let t = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                userid: visitorId, tweetid: sp.Member}, [])
            if (!t) {
                let authSid = lapi.BELoginAsAuthor()
                try {
                    lapi.MiMeiSync(authSid, "", sp.Member, {})
                } catch(e) {
                    console.error("Error get_tweet_feed", sp.Member, e)
                }
            } else {
                if (t.timestamp < lastScore) {
                    lastScore = t.timestamp     // get the earliest (smallest) tweet's timestamp
                }
            }
            return t
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