((request, args)=>{
    // let ScorePair = new Function('score', 'member', 'return {score, member}')
    // request, lapi are global variables.
    // each comment is also tweet object.
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const hostId = request["hostid"]

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const req = {aid: APP_ID, ver: "last", nid: hostId, sid: systemSid,
                tweet: request["tweet"]}
            const tweetId = lapi.RunMApp("add_tweet_host", req, [])

            lapi.MiMeiSync(systemSid, "", tweetId, {})
            return tweetId
        } else {
            const req = {aid: APP_ID, ver: "last", tweet: request["tweet"]}
            return lapi.RunMApp("add_tweet_host", req, [])
        }
    } catch(e) {
        console.error("Error add_tweet", JSON.stringify(request), e)
    }
})(request, args)
