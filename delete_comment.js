/**
 * Delete a comment from a tweet. Both comment author and tweet author
 * can delete the comment.
 */
((request, args)=>{
    try {
        const COMMENT_LIST = "comment_list_key"
        const APP_ID = request["aid"]
        const appUserId = request["appuserid"]
        const tweetId = request["tweetid"]
        const commentId = request["commentid"]
        const hostId = request["hostid"]
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            let ret = lapi.RunMApp("delete_comment", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                appuserid: appUserId, tweetid: tweetId, commentid: commentId},
                [])
            try {
                // if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                    lapi.MiMeiProvide(systemSid, "", tweetId)
                // }
            } catch(e) {
                console.error("delete_comment Error sync tweet", e, JSON.stringify(ret))
            }
            return ret
        } else {
            const authSid = lapi.BELoginAsAuthor()
            const commentSid = lapi.MMOpen(authSid, commentId, "cur")
            lapi.MMDelVers(commentSid, commentId)   // delete the comment
    
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            lapi.MMDelRef(tweetSid, tweetId, commentId) // delete the reference to the comment
            lapi.Zrem(tweetSid, COMMENT_LIST, commentId)
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)
    
            // update the score of the tweet in AppData
            lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
                userid: appUserId, mid: tweetId}, [])
    
            let lastSid = lapi.MMOpen("", tweetId, "last")
            const commentCount = lapi.Zcard(lastSid, COMMENT_LIST)
            return {commentId: commentId, count: commentCount}
        }
    } catch(e) {
        console.error("Error delete_comment", e, JSON.stringify(request))
    }
})(request, args)