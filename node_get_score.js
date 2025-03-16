((request, args)=>{
    const APP_ID = request["aid"]
    const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)
    const userId = request["userid"]
    const mid = request["mid"]
    try {
        let ret = lapi.Zscore(mmsid, userId, mid)
        return ret
    } catch(e) {
        lapi.Zaddwithseq(mmsid, userId, mid)    // update the score
        console.error("Error node_get_score", e, JSON.stringify(request))
    }
})(request, args)