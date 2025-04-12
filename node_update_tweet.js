/**
 * Compare the score of the given tweet's MimeiId. If it is out of date, sync it.
 * 
 *  */
((request, args)=>{
    const COMMENT_LIST = "comment_list_key"
    const APP_ID = request["aid"]
    const hostId = request["hostid"]
    const userId = request["userid"]
    const tweetId = request["tweetid"]
    const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

    try {
        // get new score from the remote host
        const newScore = lapi.RunMApp("node_get_score", { aid: APP_ID, ver: request.ver,
            userid: userId, mid: tweetId,
            nid: hostId,        // remote host id
            sid: systemSid,     // necessary to prove the user's authenticity.
        }, [])
        // get old score from current node data.
        const oldScore = lapi.Zscore(systemSid, userId, tweetId)

        if (newScore != oldScore) {
            console.log("New and old score of tweet", tweetId, newScore, oldScore, "of user", userId)
            if (!lapi.MFIsExist("", tweetId)) {
                lapi.MiMeiSync(systemSid, "", tweetId, {})
                lapi.MiMeiProvide(systemSid, "", tweetId)
            }
            const sp = getScorePair(newScore, tweetId)
            lapi.Zadd(systemSid, userId, sp)
            
            // Now tweet core data has been synced, update comments of the tweet.
            // comment list is a Redis Zset
            const tweetSid = lapi.MMOpen("", tweetId, "last")
            lapi.Zrevrange(tweetSid, COMMENT_LIST, 0, -1).forEach(sp => {
                // sync comment one by one
                if (!lapi.MFIsExist(systemSid, sp.Member)) {
                    lapi.MiMeiSync(systemSid, "", sp.Member, {})
                    lapi.MiMeiProvide(systemSid, "", sp.Member)
                }
            })
        }
    } catch(e) {
        // if the tweet is never synced before, there is no score in the node data.
        // which will cuase the exception. Initialize the score here and sync the tweet.
        console.error("Error node_update_tweet", e, JSON.stringify(request))
        lapi.Zaddwithseq(systemSid, userId, tweetId)    // update the score if it is missing.
        if (!lapi.MFIsExist("", tweetId)) {
            lapi.MiMeiSync(systemSid, "", tweetId, {})
            lapi.MiMeiProvide(systemSid, "", tweetId)
        }
        const tweetSid = lapi.MMOpen("", tweetId, "last")
        lapi.Zrevrange(tweetSid, COMMENT_LIST, 0, -1).forEach(sp => {
            // sync comment one by one
            if (!lapi.MFIsExist(systemSid, sp.Member)) {
                lapi.MiMeiSync(systemSid, "", sp.Member, {})
                lapi.MiMeiProvide(systemSid, "", sp.Member)
            }
        })
    }

    function getScorePair(score, member) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = score ? score : 0
        sp.Member = member
        return sp
    }

})(request, args)