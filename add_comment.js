((request, args)=>{
/**
 * Deputy function to add a comment to a specific tweet.
 *
 * @param {string} tweetId - The ID of the tweet to which the comment is being added.
 * @param {string} comment - The comment object, which is a Tweet object itself.
 * @param {string} [userId] - (Optional) The ID of the user posting the comment.
 */
    try {
        const COMMENT_LIST = "comment_list_key"
        const APP_ID = request["aid"]
        const userId = request["userid"]    // appUser who makes the comment
        const tweetId = request["tweetid"]  // tweet commented to
        const hostId = request["hostid"]    // host where the tweet is published.
        const comment = JSON.parse(request["comment"])

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const req = {aid: APP_ID, ver: "last", nid: hostId, sid: systemSid,
                userid: userId, tweetid: tweetId, comment: JSON.stringify(comment)}
            let ret = JSON.parse(lapi.RunMApp("add_comment_host", req, []))

            // sync tweet to node from where appUser is being loaded.
            lapi.MiMeiSync(systemSid, "", tweetId, {})

            // sync all comments of the tweet to local node
            const tweetSid = lapi.MMOpen("", tweetId, "last")
            lapi.Zrange(tweetSid, COMMENT_LIST, 0, -1).forEach(element => {
                if (!lapi.MFIsExist("", element.Member))
                    lapi.MiMeiSync(systemSid, "", element.Member, {})
            })
            return ret
        } else {
            const req = {aid: APP_ID, ver: "last",
                userid: userId, tweetid: tweetId, comment: JSON.stringify(comment)}
            return lapi.RunMApp("add_comment_host", req, [])
        }
    } catch(e) {
        console.error("Error add_comment", e, JSON.stringify(request))
    }
})(request, args)
