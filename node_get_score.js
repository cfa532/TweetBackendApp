((request, args)=>{
    const APP_ID = request["aid"]
    const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)
    const userId = request["userid"]
    const mid = request["mid"]
    try {
        const rank = lapi.Zrank(mmsid, userId, mid)
        if (rank === -1) {
            // score not exist, assign the global sequence number as score of the mid
            lapi.Zaddwithseq(mmsid, userId, mid)
        }
        // Zscore will throw exception if the scorepair does not exist.
        return lapi.Zscore(mmsid, userId, mid)
    } catch(e) {
        console.error("Error node_get_score", e, JSON.stringify(request))
    }
})(request, args)