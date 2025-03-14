/**
 * Add a new tweet to the local host.
 */
((request, args)=>{
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const hostId = request["hostid"]

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const tweet = lapi.RunMApp("add_tweet_host", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid, tweet: request["tweet"]}, []
            )
            console.log("add_tweet remote", tweet)
            // tweet is created in remote host, sync it here.
            // lapi.MiMeiSync(systemSid, "", tweet.mid, {})

            return JSON.parse(tweet).mid
        } else {
            const tweet = lapi.RunMApp("add_tweet_host", {aid: APP_ID, ver: "last",
                tweet: request["tweet"]}, []
            )
            console.log("add_tweet local", JSON.stringify(tweet))

            // Now sync the original tweet to the current node
            // if (tweet.originalTweetId) {
            //     lapi.MiMeiSync(authSid, "", tweet.originalTweetId, {})
            //     lapi.MiMeiProvide(authSid, "", tweet.originalTweetId)
            // }
            return tweet.mid
        }
    } catch(e) {
        console.error("Error add_tweet", JSON.stringify(request), e)
    }
})(request, args)
