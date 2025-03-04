((request, args)=>{
    // update the score of given Mimei Id in AppData. With this score, any change in the mimei
    // will be reflected in the AppData.
    try {
        const APP_ID = request["aid"]
        const userId = request["userid"]
        const mid = request["mid"]
        const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)
        let ret = lapi.Zaddwithseq(mmsid, userId, mid)
        if (mid != userId) {
            // It means the mid is not the user's own mimei id.
            // In this case, we need to update the score of the user's mimei id as well.
            ret = lapi.Zaddwithseq(mmsid, userId, userId)
        }
        console.log("update score", userId, mid, lapi.Zscore(mmsid, userId, mid))
    } catch(e) {
        console.error("Error node_update_score", JSON.stringify(request), e)
    }
})(request, args)