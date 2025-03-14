/**
 * Add a new tweet to the local host.
 */
((request, args)=>{
    let tweetId = ""; // Initialize tweetId outside the try block
    try {
        const APP_EXT = "com.example.twitterclone"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const APP_ID = request["aid"]
        const hostId = request["hostid"]

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            tweetId = lapi.RunMApp("add_tweet", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                hostid: hostId, tweet: request["tweet"]}, []
            )
            // tweet is created in remote host, sync it here.
            console.log("add_tweet remote", tweetId)
            lapi.MiMeiSync(systemSid, "", tweetId, {})

            return tweetId
        } else {
            const tweet = JSON.parse(request['tweet'])
            const authSid = lapi.BELoginAsAuthor()
            tweetId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            tweet["mid"] = tweetId
            tweet["timestamp"] = Date.now()    
            lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)
    
            tweet.attachments?.forEach(element => {
                lapi.MMAddRef(tweetSid, tweetId, element.mid)
            });
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(tweetSid, "", tweetId)     // publish the tweet ID.
    
            const authorId = tweet.authorId
            const userSid = lapi.MMOpen(authSid, authorId, "cur")
            lapi.Zadd(userSid, TWT_LIST_KEY, getScorePair(tweetId))
    
            lapi.MMAddRef(userSid, authorId, tweetId)
            lapi.MMBackup(userSid, authorId, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", authorId)
    
            // update the score of the new tweet in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: tweet.authorId, mid: tweetId}, [])
            return tweetId
        }
    } catch(e) {
        console.error("Error add_tweet", e, JSON.stringify(request))
        return tweetId; // Return tweetId even if there's an error
    }

    function getScorePair(mid) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = Date.now()
        sp.Member = mid
        return sp
    }
})(request, args)
