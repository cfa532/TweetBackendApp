((request, args)=>{
    // Compare the score of the given MimeiId. If it is out of date, sync it.
    const COMMENT_LIST = "comment_list_key"
    const APP_ID = request["aid"]
    const hostId = request["hostid"]
    const userId = request["userid"]
    const tweetId = request["tweetid"]
    const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)

    try {
        req = {aid: APP_ID, ver: request.ver, userid: userId, mid: tweetId,
            nid: hostId,    // remote host id
            sid: mmsid,     // necessary to prove the user's authenticity.
        }
        // get new score from the remote host
        const newScore = lapi.RunMApp("node_get_score", req, [])
        // get old score from node data.
        const oldScore = lapi.Zscore(mmsid, userId, tweetId)

        if (newScore != oldScore) {
            console.log("new and old score", newScore, oldScore, userId, tweetId)
            lapi.MiMeiSync(mmsid, "", tweetId, {})
            sp = new ScorePair
            sp.Score = newScore ? newScore : 0
            sp.Member = tweetId
            lapi.Zadd(mmsid, userId, sp)    // update the score of tweet
            
            // Now tweet core data has been synced, update comments of the tweet.
            // comment list is a Redis Zset
            const tweetSid = lapi.MMOpen("", tweetId, "last")
            lapi.Zrevrange(tweetSid, COMMENT_LIST, 0, -1).forEach(sp => {
                // sync comment one by one
                if (!lapi.MFIsExist(mmsid, sp.Member)) {
                    lapi.MiMeiSync(mmsid, "", sp.Member, {})
                }
            })
        }
    } catch(e) {
        lapi.Zaddwithseq(mmsid, userId, tweetId)    // update the score
        console.error("Error node_update_tweet", e, JSON.stringify(request))
    }

    function ScorePair() {}

})(request, args)