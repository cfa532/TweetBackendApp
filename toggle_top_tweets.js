((request, args)=>{
    /**
     * Toggle pinned tweets and return updated pinned tweets list.
     */
    try {
        const TOP_TWEETS = "top_tweet_list"
        const authSid = lapi.BELoginAsAuthor()
        let tweetId = request["tweetid"]
        let userId = request["userid"]
        let mmsid = lapi.MMOpen(authSid, userId, "cur")

        let topTweet = lapi.Hget(mmsid, TOP_TWEETS, tweetId)
        if (topTweet) {
            lapi.Hdel(mmsid, TOP_TWEETS, tweetId)
        } else {
            lapi.Hset(mmsid, TOP_TWEETS, tweetId, Date.now())
        }
        lapi.MMBackup(authSid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)

        // update the score of the user in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: userId}, [])
        
        return lapi.RunMApp("get_top_tweets", {aid: request["aid"], ver:"last",
            userid: userId}, [])
    } catch(e) {
        console.error("Error toggle_top_tweets", JSON.stringify(request), e)
    } 
})(request, args)