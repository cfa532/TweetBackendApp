((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const startScore = parseInt(request["start"], 10)
        const endScore = parseInt(request["end"], 10)
        const userId = request["userid"]
        const visitorId = request["gid"]  // user who is accessing the tweets
        const mmsid = lapi.MMOpen("", userId, "last")
    
        let arr = lapi.Zrangebyscore(mmsid, TWT_LIST_KEY, endScore, startScore, 0, 100)
        return arr.map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                userid: visitorId, tweetid: sp.Member}, [])
        }).filter(e=> e)
    } catch(e) {
        console.error("Error get_user_tweets", JSON.stringify(request), e)
    }
})(request, args)