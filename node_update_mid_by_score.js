/**
 * Compare the score of the given tweet's MimeiId. If it is out of date, sync it.
 * 
 *  */
((request, args)=>{
    const APP_ID = request["aid"]
    const hostId = request["hostid"]
    const userId = request["userid"]
    const mid = request["mid"]
    const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

    const rank = lapi.Zrank(systemSid, userId, mid)
    if (rank == -1) {
        lapi.Zaddwithseq(systemSid, userId, mid)
        lapi.MiMeiSync(systemSid, "", mid, {})
        lapi.MiMeiProvide(systemSid, "", mid)
    } else {
        // get new score from the remote host
        const newScore = lapi.RunMApp("node_get_score", { aid: APP_ID, ver: request.ver,
            nid: hostId,        // remote host id
            sid: systemSid,     // necessary to prove the user's authenticity.
            userid: userId, mid: mid,
        }, [])

        // get old score from current node.
        const oldScore = lapi.Zscore(systemSid, userId, mid)

        if (newScore != oldScore) {
            console.log(mid, "new and old score:", newScore, oldScore, "of user", userId)
            // Only sync the tweet itself. Update comments when viewing tweet details.
            lapi.MiMeiSync(systemSid, "", mid, {})
            const sp = getScorePair(newScore, mid)
            lapi.Zadd(systemSid, userId, sp)
        }
    }

    function getScorePair(score, member) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = score ? score : 0
        sp.Member = member
        return sp
    }

})(request, args)