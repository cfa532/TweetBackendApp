((request, args)=>{
    /**
     * Given userId and time span, return a list of tweet IDs
     */
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        let startScore = parseInt(request["start"], 10)
        let endScore = request["end"]!="null" ? parseInt(request["end"], 10) : Date.now()
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
    
        let arr = lapi.Zrangebyscore(mmsid, TWT_LIST_KEY, endScore, startScore, 0, 100)
        console.log("get_tweet_list", startScore, endScore, userId)
        return arr.map(sp => {return sp.Member})
    } catch(e) {
        console.error("Error get_tweet_list", JSON.stringify(request), e)
    }
})(request, args)