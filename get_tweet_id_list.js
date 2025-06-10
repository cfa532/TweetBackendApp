((request, args)=>{
    /**
     * Given userId and time span, return a list of tweet IDs
     */
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const mmsid = lapi.MMOpen("", request["userid"], "last")
        const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, 0, -1)
        return arr
    } catch(e) {
        console.error("Error get_tweet_id_list", JSON.stringify(request), e)
    }
})(request, args)