((request, args)=>{
    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }

    try {
        // add new comment to the tweet
        const APP_ID = request["aid"]
        const userId = request["userid"]
        const user = getUser(userId)
        const tweetId = request["tweetid"]
        const commentId = request["commentid"]
        const hostId = request["hostid"]

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const req = {aid: APP_ID, ver: "last", nid: hostId, sid: systemSid,
                userid: userId, tweetid: tweetId, commentid: commentId}
            let ret = lapi.RunMApp("delete_comment_host", req, [])

            lapi.MiMeiSync(systemSid, "", tweetId, {})
            return ret
        } else {
            const req = {aid: APP_ID, ver: "last",
                userid: userId, tweetid: tweetId, commentid: commentId}
            return lapi.RunMApp("delete_comment_host", req, [])
        }
    } catch(e) {
        console.error("Error delete_comment", e, JSON.stringify(request))
    }
})(request, args)