((request, args)=>{
    try {
        // add new comment to the tweet
        const COMMENT_LIST = "comment_list_key"

        let commentId = request["commentid"]
        let userId = request["userid"]
        let tweetId = request["mid"]
        let authSid = lapi.BELoginAsAuthor()

        let csid = lapi.MMOpen(authSid, commentId, "cur")
        lapi.MMDelVers(csid, commentId)
        lapi.MMBackup(authSid, commentId, "", "delref=true")
        lapi.MMDelRef(authSid, tweetId, commentId)

        let mmsid = lapi.MMOpen(authSid, tweetId, "cur")
        lapi.Zrem(mmsid, COMMENT_LIST, commentId)
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetId)
        lapi.MiMeiPublish(authSid, "", userId)

        // update the score of the tweet in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: tweetId}, [])
        return count
    } catch(e) {
        console.error("Error delete_comment:", JSON.stringify(request), e)
    }
})(request, args)