/**
 * Delete a comment from a tweet. Both comment author and tweet author
 * can delete the comment.
 */
((request, args)=>{
    try {
        const APP_ID = request["aid"]
        const appUserId = request["appuserid"]
        const tweetId = request["tweetid"]
        const commentId = request["commentid"]
        const hostId = request["hostid"]

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("delete_comment_host", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                appuserid: appUserId, tweetid: tweetId, commentid: commentId}, [])
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
            const req = {aid: APP_ID, ver: "last",
                userid: appUserId, tweetid: tweetId, commentid: commentId}
            return lapi.RunMApp("delete_comment_host", req, [])
        }
    } catch(e) {
        console.error("Error delete_comment", e, JSON.stringify(request))
    }
})(request, args)