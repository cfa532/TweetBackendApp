((request, args)=>{
    /**
     * update the score of given Mimei Id in AppData, any change in the mimei
     * will be reflected in the AppData.
     * 
     * On the host of this mimei, the score is updated to reflect the change made to it.
     * On other nodes, the score is updated to remember score of a single source of truth.
     */
    try {
        const APP_ID = request["aid"]
        const userId = request["userid"]
        const mid = request["mid"]
        const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)
        let ret = lapi.Zaddwithseq(mmsid, userId, mid)
    } catch(e) {
        console.error("Error node_update_score", e, JSON.stringify(request))
    }
})(request, args)