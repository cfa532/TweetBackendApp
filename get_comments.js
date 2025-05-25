((request, args)=>{
    try {
        // Given authorId and tweetId, load all comments.
        const COMMENT_LIST = "comment_list_key"
        const appUserId = request["appuserid"]
        let tweetId = request["tweetid"]
        let mmsid = lapi.MMOpen("", tweetId, "last")
    
        let arr = lapi.Zrevrange(mmsid, COMMENT_LIST, 0, -1)
        let ret = arr.map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: sp.Member}, [])
        }).filter(e=> e)
        return ret
    } catch(e) {
        console.error("Error get_comments:", JSON.stringify(request), e)
    }
})(request, args)