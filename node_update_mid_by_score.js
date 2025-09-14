/**
 * Compare the score of the given mid with its score on the remote host.
 * If they are different, sync the mid from the remote host
 * and update the score on the current node.
 * 
 * This function ensures data consistency across nodes by comparing
 * scores and syncing when discrepancies are found.
 */
((request, args) => {
    // Extract request parameters
    const APP_ID = request["aid"]
    const hostId = request["hostid"]
    const userId = request["userid"]
    const mid = request["mid"]
    const nodeId = lapi.GetVar("", "hostid")

    // Skip processing if we're already on the target host
    if (nodeId === hostId) {
        return
    }

    // Check if the mid exists in the sorted set
    const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
    const rank = lapi.Zrank(systemSid, userId, mid)
    if (rank === -1) {
        // The mid has never been synced before, add it to AppData
        // Add a score pair with system sequence number as score
        lapi.Zaddwithseq(systemSid, userId, mid)
        lapi.MiMeiSync(systemSid, "", mid, {})
        lapi.MiMeiProvide(systemSid, "", mid)
    }

    // Get the current score from the remote host
    const remoteScore = lapi.RunMApp("node_get_score", { 
        aid: APP_ID, 
        ver: request.ver,
        nid: hostId,        // remote host id
        sid: systemSid,     // necessary to prove the user's authenticity
        userid: userId, 
        mid: mid,
    }, [])

    // Get the current score from the local node
    const localScore = lapi.Zscore(systemSid, userId, mid)

    // If scores differ, sync and update the local score
    if (remoteScore !== localScore) {
        console.log(mid, "new and old score:", remoteScore, localScore, "of user", userId)
        
        // Sync the mid data from remote host
        lapi.MiMeiSync(systemSid, "", mid, {})

        // Update the score of the user in local AppData
        const sp = getScorePair(remoteScore, mid)
        lapi.Zadd(systemSid, userId, sp)
    }

    /**
     * Creates a score pair object for storing in sorted sets
     * @param {number} score - The score value
     * @param {string} member - The member identifier
     * @returns {Object} ScorePair object with Score and Member properties
     */
    function getScorePair(score, member) {
        function ScorePair() {}
        const sp = new ScorePair()
        sp.Score = score ? score : 0
        sp.Member = member
        return sp
    }

})(request, args)