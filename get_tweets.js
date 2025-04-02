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
            console.log("get_tweets", JSON.stringify(t))
            if (!t) {
                let authSid = lapi.BELoginAsAuthor()
                try {
                    lapi.MiMeiSync(authSid, "", sp.Member, {})
                } catch(e) {
                    console.error("Error get_tweets", sp.Member, e)
                }
            } else {
                if (t.timestamp < lastScore) {
                    lastScore = t.timestamp     // get earliest tweet's timestamp
                }
            }
            return t
        }).filter(e=> e)

        /**
         * Retrieve the tweets of appUser during the same time span of the followings tweets
         */
        return lapi.Zrangebyscore(mmsid, TWT_LIST_KEY, lastScore, Date.now(), 0, 100)
        .map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                userid: visitorId, tweetid: sp.Member}, [])
        }).concat(arr)
    } catch(e) {
        console.error("Error get_tweets", JSON.stringify(request), e)
    }
})(request, args)