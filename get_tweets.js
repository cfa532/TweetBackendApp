((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"

        let startScore = parseInt(request["start"], 10)
        let endScore = request["end"]!="null" ? parseInt(request["end"], 10) : Date.now()
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
    
        console.log("get_tweets", startScore, endScore)
        let arr = lapi.Zrangebyscore(mmsid, TWT_LIST_KEY, endScore, startScore, 0, 100)
        return arr.map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last", userid: userId, tweetid: sp.Member}, [])
        }).filter(e=> e)
    } catch(e) {
        console.error(e)
        return e
    }
})(request, args)