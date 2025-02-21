((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        let startRank = parseInt(request["start"], 10)
        let endRank = parseInt(request["end"], 10)
        let userId = request["userid"]
        let visitorId = request["gid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        
        let arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, startRank, endRank)
        console.log("get_tweets_by_rank", startRank, endRank, JSON.stringify(arr))
        return arr.map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                userid: visitorId, tweetid: sp.Member}, [])
        }).filter(e=> e)
    } catch(e) {
        console.error("Error get_tweets_by_rank", JSON.stringify(request), e)
    }
})(request, args)