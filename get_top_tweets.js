((request, args)=>{
    try {
        /**
         * Get list of pinned tweet IDs from a hash set.
         */
        const TOP_TWEETS = "top_tweet_list"
        let mmsid = lapi.MMOpen("", request["userid"], "last")
        return lapi.Hkeys(mmsid, TOP_TWEETS).map(tid => {
            let ts = lapi.Hget(mmsid, TOP_TWEETS, tid).toString()
            return {tweetId: tid, timestamp: ts}
        });
    } catch(e) {
        console.error("Error get_top_tweets:", JSON.stringify(request), e)
    }
})(request, args)