// ((request, args)=>{
    try {
        // add new comment to the tweet
        const COMMENT_LIST = "comment_list_key"
        const commentId = request["commentid"]
        const userId = request["userid"]
        const tweetId = request["tweetid"]
        const authSid = lapi.BELoginAsAuthor()

        const commentSid = lapi.MMOpen(authSid, commentId, "cur")
        lapi.MMDelVers(commentSid, commentId)
        lapi.MMDelRef(authSid, tweetId, commentId)

        const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
        lapi.Zrem(tweetSid, COMMENT_LIST, commentId)

        lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetId)

        // update the score of the tweet in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: tweetId}, [])

        // lapi.Zcard(tweetSid, COMMENT_LIST)      // return the number of comments
        commentId   // return the deleted commentId
    } catch(e) {
        console.error("Error delete_comment_host", JSON.stringify(request), e)
    }
// })(request, args)