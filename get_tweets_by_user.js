/**
 * Given user Id, get its tweets of the given range.
 */
((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const startRank = parseInt(request["start"], 10)  // smaller
        const endRank = parseInt(request["end"], 10)      // larger
        const userId = request["userid"]
        const appUserId = request["appuserid"]
        const mmsid = lapi.MMOpen("", userId, "last")
        
        const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, startRank, endRank)
        return arr.map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: sp.Member}, [])
        })
    } catch(e) {
        console.error("Error get_tweets_by_rank", JSON.stringify(request), e)
        return []
    }
})(request, args)