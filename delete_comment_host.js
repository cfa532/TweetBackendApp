((request, args)=>{
    try {
        // add new comment to the tweet
        const COMMENT_LIST = "comment_list_key"
        const commentId = request["commentid"]
        const userId = request["userid"]
        const tweetId = request["tweetid"]
        const authSid = lapi.BELoginAsAuthor()

        let commentSid = lapi.MMOpen(authSid, commentId, "cur")
        lapi.MMDelVers(commentSid, commentId)
        lapi.MMDelRef(authSid, tweetId, commentId)

        let tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
        lapi.Zrem(tweetSid, COMMENT_LIST, commentId)
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetId)
        lapi.MiMeiPublish(authSid, "", userId)

        // update the score of the tweet in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: tweetId}, [])
        return lapi.Zcard(tweetSid, COMMENT_LIST)
    } catch(e) {
        console.error("Error delete_comment_host", JSON.stringify(request), e)
    }
})(request, args)