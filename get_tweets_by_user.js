/**
 * Given user Id, get its tweets of the given range.
 */
((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const pageNum = parseInt(request["pn"], 10)
        const pageSize = parseInt(request["ps"], 10)
        const startRank = pageNum * pageSize
        const endRank = startRank + pageSize - 1
        const userId = request["userid"]
        const appUserId = request["appuserid"]
        const mmsid = lapi.MMOpen("", userId, "last")

        const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, startRank, endRank)
        return arr.map(sp => {
            const tweetId = sp.Member
            const tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: tweetId}, [])
            // if (!tweet) {
            //     return { tid: tweetId, tweet: null }
            // } else {
            //     return { tid: tweetId, tweet: tweet }
            // }
            console.log("tweet by user", JSON.stringify(tweet))
            return tweet
        })
    } catch(e) {
        console.error("Error get_tweets_by_rank", JSON.stringify(request), e)
    }
})(request, args)