((request, args)=>{
    try {
        const COMMENT_LIST = "comment_list_key"

        let tweetId = request["tweetid"]
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", tweetId, "last")
    
        let arr = lapi.Zrevrange(mmsid, COMMENT_LIST, 0, -1)
        let ret = arr.map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last", userid: userId, tweetid: sp.Member}, [])
        })
        return JSON.stringify(ret)
    } catch(e) {
        return e
    }
})(request, args)