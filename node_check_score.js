((request, args)=>{
    // Compare the score of the given MimeiId. If it is out of date, sync it.
    const APP_ID = request["aid"]
    const hostId = request["hostid"]
    const userId = request["userid"]
    const mid = request["mid"]
    const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)
    try {
        let currentHost = lapi.GetVar("", "hostid")
        console.log("check score host", currentHost, hostId)

        req = {aid: APP_ID, ver: request.ver, userid: userId, mid: mid,
            nid: hostId,    // remote host id
            sid: mmsid,     // necessary to prove the user's authenticity.
        }
        // get new score from the remote host
        let newScore = lapi.RunMApp("node_get_score", req, [])
        console.log("Check remote new score", newScore, hostId, userId, mid)

        oldScore = lapi.Zscore(mmsid, userId, mid)
        console.log("check local old score", oldScore, userId, mid)

        if (newScore != oldScore) {
            lapi.MiMeiSync(mmsid, "", mid, {})
            setScore(mmsid, userId, newScore, mid)
        }
    } catch(e) {
        lapi.Zaddwithseq(mmsid, userId, mid)    // update the score
        console.error("Error node_check_score", e, JSON.stringify(request))
    }

    function setScore(mmsid, userId, score, mid) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = score ? score : 0
        sp.Member = mid
        lapi.Zadd(mmsid, userId, sp)    // update the score
}
})(request, args)