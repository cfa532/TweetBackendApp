((request, args)=>{
    try {
        /**
         * Get list of pinned tweet IDs from a hash set.
         */
        const PINNED_TWEETS = "pinned_tweet_list"
        const appUserId = request["appuserid"]
        const userId = request["userid"]
        const mmsid = lapi.MMOpen("", userId, "last")

        return lapi.Hkeys(mmsid, PINNED_TWEETS).map(tweetId => {
            let ts = lapi.Hget(mmsid, PINNED_TWEETS, tweetId).toString()
            let tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: tweetId}, [])
            if (tweet) {
                // timestamp is the time when the tweet was pinned, not its creation time.
                return {tweet: tweet, timestamp: ts}
            }
        }).filter(e=> e);
    } catch(e) {
        console.error("Error get_pinned_tweets:", e, JSON.stringify(request))
        return []
    }
})(request, args)