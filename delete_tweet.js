((request, args)=>{
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const hostId = request["hostid"]
        const tweetId = request["tweetid"]    // tweet Id to be removed
        const userId = request["authorid"]

        const nodeId = lapi.GetVar("", "hostid")    // current node id
        console.log("Delete tweet ", tweetId, " on host ", hostId, nodeId)
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const req = {aid: APP_ID, ver: "last", nid: hostId, sid: systemSid,
                tweetid: tweetId, authorid: userId}
            let ret = lapi.RunMApp("delete_tweet_host", req, [])
            return ret
        } else {
            const req = {aid: APP_ID, ver: "last", tweetid: tweetId, authorid: userId}
            return lapi.RunMApp("delete_tweet_host", req, [])
        }
    } catch(e) {
        console.error("Error delete_tweet", JSON.stringify(request), e)
    }
})(request, args)