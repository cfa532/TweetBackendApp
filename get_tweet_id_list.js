/**
 * Return a list of public tweets of the user from the user's host.
 * To make sure we get the most reliable data.
 */

((request, args)=>{
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const TWT_LIST_KEY = "list_of_tweets_mid"
    const userId = request["userid"]

    try {
        const mmsid = lapi.MMOpen("", userId, "last")
        // TODO: -1 might fail. Retreive 100 for now.
        const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, 0, -1)
        .map(e => {
            const mmsid = lapi.MMOpen("", e.Member, "last")
            const tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
            if (tweet && !tweet.isPrivate) {
                // Only return the tweet if it is public
                return e
            }
        }).filter(e=> e)
        return arr    // return the list of scorepairs
    } catch(e) {
        console.error("Error get_tweet_id_list", e, JSON.stringify(request))
        return []
    }
})(request, args)