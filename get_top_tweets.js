((request, args)=>{
    try {
        /**
         * Get list of pinned tweet IDs from a hash set.
         */
        const TOP_TWEETS = "top_tweet_list"
        let mmsid = lapi.MMOpen("", request["userid"], "last")
        return lapi.Hkeys(mmsid, TOP_TWEETS).map(element => {
            let ts = lapi.Hget(mmsid, TOP_TWEETS, element).toString()
            return {tweetId: element, timestamp: ts}
        });
    } catch(e) {
        console.error("Error get_top_tweets:", JSON.stringify(request), e)
    }
})(request, args)