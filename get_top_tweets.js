((request, args)=>{
    try {
        /**
         * Get list of pinned tweet IDs from a hash set.
         */
        const PINNED_TWEETS = "top_tweet_list"
        const visitorId = request["gid"]
        const mmsid = lapi.MMOpen("", request["userid"], "last")

        return lapi.Hkeys(mmsid, PINNED_TWEETS).map(tweetId => {
            let ts = lapi.Hget(mmsid, PINNED_TWEETS, tweetId).toString()
            let tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                userid: visitorId, tweetid: tweetId}, [])
            if (tweet) {
                // timestamp is the time when the tweet was pinned, not its creation time.
                return {tweet: tweet, timestamp: ts}
            }
            return null
        }).filter(e=> e);
    } catch(e) {
        console.error("Error get_top_tweets:", JSON.stringify(request), e)
    }
})(request, args)