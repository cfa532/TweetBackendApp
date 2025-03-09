((request, args)=>{
    // Compare the score of the given MimeiId. If it is out of date, sync it.
    const APP_ID = request["aid"]
    const hostId = request["hostid"]
    const userId = request["userid"]
    const tweetId = request["mid"]
    const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)
    try {
        req = {aid: APP_ID, ver: request.ver, userid: userId, mid: tweetId,
            nid: hostId,    // remote host id
            sid: mmsid,     // necessary to prove the user's authenticity.
        }
        // get new score from the remote host
        let newScore = lapi.RunMApp("node_get_score", req, [])
        let oldScore = lapi.Zscore(mmsid, userId, tweetId)
        if (newScore != oldScore) {
            console.log("new and old score", newScore, oldScore, userId, tweetId)
            
            let authSid = lapi.BELoginAsAuthor()
            lapi.MiMeiSync(authSid, "", tweetId, {})

            setScore(mmsid, userId, newScore, tweetId)
            
            // Now tweet core data has been synced, update comments of the tweet.
            const COMMENT_LIST = "comment_list_key"
            let twsid = lapi.MMOpen("", tweetId, "last")
            lapi.Zrevrange(twsid, COMMENT_LIST, 0, -1).forEach(sp => {
                // lapi.MiMeiSync(authSid, "", sp.Member, {})
                // reading comment one by one
                console.log("Exist?", lapi.MFIsExist(authSid, sp.Member), sp.Member)
                if (!lapi.MFIsExist(authSid, sp.Member)) {
                    lapi.MiMeiSync(authSid, "", sp.Member, {})
                }
            })
        }
    } catch(e) {
        lapi.Zaddwithseq(mmsid, userId, tweetId)    // update the score
        console.error("Error node_update_tweet", e, JSON.stringify(request))
    }

    function setScore(mmsid, userId, score, mid) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = score ? score : 0
        sp.Member = mid
        lapi.Zadd(mmsid, userId, sp)    // update the score
}
})(request, args)