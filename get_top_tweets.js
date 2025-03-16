((request, args)=>{
    try {
        /**
         * Get list of pinned tweet IDs from a hash set.
         */
        const PINNED_TWEETS = "top_tweet_list"
        let mmsid = lapi.MMOpen("", request["userid"], "last")
        return lapi.Hkeys(mmsid, PINNED_TWEETS).map(tid => {
            let ts = lapi.Hget(mmsid, PINNED_TWEETS, tid).toString()
            return {tweetId: tid, timestamp: ts}
        });
    } catch(e) {
        console.error("Error get_top_tweets:", JSON.stringify(request), e)
    }
})(request, args)