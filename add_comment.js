((request, args)=>{
/**
 * Deputy function to add a comment to a specific tweet.
 *
 * @param {string} tweetId - The ID of the tweet to which the comment is being added.
 * @param {string} comment - The comment object, which is a Tweet object itself.
 * @param {string} [userId] - (Optional) The ID of the user posting the comment.
 */
    try {
        const APP_ID = request["aid"]
        const userId = request["userid"]
        const tweetId = request["tweetid"]
        const hostId = request["hostid"]
        const comment = JSON.parse(request["comment"])

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const req = {aid: APP_ID, ver: "last", nid: hostId, sid: systemSid,
                userid: userId, tweetid: tweetId, comment: JSON.stringify(comment)}
            let ret = lapi.RunMApp("add_comment_host", req, [])
            let authSid = lapi.BELoginAsAuthor()
            lapi.MiMeiSync(authSid, "", ret["commentId"], {})
            lapi.MiMeiSync(authSid, "", tweetId, {})
            return ret
        } else {
            const req = {aid: APP_ID, ver: "last",
                userid: userId, tweetid: tweetId, comment: JSON.stringify(comment)}
            return lapi.RunMApp("add_comment_host", req, [])
        }
    } catch(e) {
        console.error("Error add_comment", JSON.stringify(request), e)
    }
})(request, args)
