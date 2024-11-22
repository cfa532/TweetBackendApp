((request, args)=>{
    try {
        // request, lapi are global variables
        // each comment is a tweet object
        const COMMENT_COUNT = "tweet_comment_count"
        const COMMENT_LIST = "comment_list_key"

        let commentId = request["commentid"]
        let tweetId = request["tweetid"]
        let authSid = lapi.BELoginAsAuthor()

        let csid = lapi.MMOpen(authSid, commentId, "cur")
        lapi.MMDelVers(csid, commentId)
        lapi.MMBackup(authSid, commentId, "", "delref=true")
        lapi.MMDelRef(authSid, tweetId, commentId)

        let mmsid = lapi.MMOpen(authSid, tweetId, "cur")
        lapi.Zrem(mmsid, COMMENT_LIST, commentId)
        let count = lapi.Get(mmsid, COMMENT_COUNT) - 1
        lapi.Set(mmsid, COMMENT_COUNT, count)
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetid)
        console.log("Delete comment", commentId, count)
        return count
    } catch(e) {
        console.error("Error delete_comment:", JSON.stringify(request), e)
    }
})(request, args)