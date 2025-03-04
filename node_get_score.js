((request, args)=>{
    const APP_ID = request["aid"]
    const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)
    const userId = request["userid"]
    const mid = request["mid"]
    try {
        let ret = lapi.Zscore(mmsid, userId, mid)
        console.log("get score", ret, userId, mid)
        return ret
    } catch(e) {
        lapi.Zaddwithseq(mmsid, userId, mid)    // update the score
        console.error("Error node_get_score", JSON.stringify(request), e)
    }
})(request, args)