((request, args)=>{
    /**
     * Given userId and time span, return a list of tweet IDs
     */
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        let startRank = parseInt(request["start"], 10)
        let endRank = startRank + parseInt(request["count"], 10)
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
    
        let arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, startRank, endRank)
            .map(sp => sp.Member)
        return arr
    } catch(e) {
        console.error("Error get_tweet_list_by_rank", JSON.stringify(request), e)
    }
})(request, args)