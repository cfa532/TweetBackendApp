((request, args)=>{
    try {
        // Given authorId and tweetId, load all comments.
        const COMMENT_LIST = "comment_list_key"
        const appUserId = request["appuserid"]
        const pageNumber = request['pn'];
        const pageSize = request['ps'];
        const startRank = pageNumber * pageSize;
        const endRank = startRank + pageSize - 1;
        const tweetId = request["tweetid"]
        const mmsid = lapi.MMOpen("", tweetId, "last")
    
        const arr = lapi.Zrevrange(mmsid, COMMENT_LIST, startRank, endRank)
        const ret = arr.map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: sp.Member}, [])
        }).filter(e=> e)
        return ret
    } catch(e) {
        console.error("Error get_comments:", JSON.stringify(request), e)
    }
})(request, args)