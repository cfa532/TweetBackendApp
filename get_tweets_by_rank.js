/**
 * Given user Id, get its tweets of the given range.
 */
((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        let startRank = parseInt(request["start"], 10)  // smaller
        let endRank = parseInt(request["end"], 10)      // larger
        let userId = request["userid"]
        let visitorId = request["gid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        
        let arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, startRank, endRank)
        return arr.map(sp => {
            let tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: visitorId, tweetid: sp.Member}, [])
            if (!tweet) {
                //  if the tweet is not available locally, sync it.
                // try {
                //     const authSid = lapi.BELoginAsAuthor()
                //     lapi.MiMeiSync(authSid, "", sp.Member, {})
                //     lapi.MiMeiProvide(authSid, "", sp.Member)
                //     tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                //         userid: visitorId, tweetid: sp.Member}, [])
                // } catch(e) {
                //     console.error("Error get_tweets_by_rank", sp.Member, e)
                // }
            }
            return tweet
        }).filter(e=> e)
    } catch(e) {
        console.error("Error get_tweets_by_rank", JSON.stringify(request), e)
        return []
    }
})(request, args)