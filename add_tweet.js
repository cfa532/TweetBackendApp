/**
 * Add a new tweet to the local host.
 */
((request, args)=>{
    const APP_ID = request["aid"]
    const hostId = request["hostid"]
    let tweetId = ""; // Initialize tweetId outside the try block

    try {
        const APP_EXT = "com.example.twitterclone"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const TWT_LIST_KEY = "list_of_tweets_mid"

        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            tweetId = lapi.RunMApp("add_tweet", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                hostid: hostId, tweet: request["tweet"]}, []
            )
            // tweet is created in remote host, sync it here.
            // lapi.MiMeiSync(systemSid, "", tweetId, {})   // TODO: remote tweet not ready yet.
            lapi.MiMeiProvide(systemSid, "", tweetId)

            console.log("add_tweet remote", tweetId)
            return tweetId
        } else {
            const friendId = getFriendByAppCode(request.nodeappcode)
            console.log("friendId=", friendId)
            if (!friendId) {
                throw new Error("Not a friend of the host", hostId)
            }
            const tweet = JSON.parse(request['tweet'])
            const authSid = lapi.BELoginAsAuthor()
            tweetId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            tweet["mid"] = tweetId
            tweet["timestamp"] = Date.now()    
            lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)
    
            tweet.attachments?.forEach(element => {
                lapi.MMAddRef(authSid, tweetId, element.mid)
            });
            lapi.MMBackup(authSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)     // publish the tweet ID.
    
            const authorId = tweet.authorId
            const userSid = lapi.MMOpen(authSid, authorId, "cur")
            lapi.Zadd(userSid, TWT_LIST_KEY, getScorePair(tweetId))
    
            lapi.MMAddRef(authSid, authorId, tweetId)
            lapi.MMBackup(authSid, authorId, "", "delref=true")
            console.log("add_tweet local", tweetId)
            lapi.MiMeiPublish(authSid, "", authorId)
    
            // update the score of the new tweet in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: tweet.authorId, mid: tweetId}, [])

            // if the tweet is a retweet of an original tweet, sync the original tweet here.
            if (tweet.originalTweetId) {
                // lapi.MiMeiSync(authSid, "", tweet.originalTweetId, {})
                lapi.MiMeiProvide(authSid, "", tweet.originalTweetId)
            }
            return tweetId
        }
    } catch(e) {
        console.error("Error add_tweet", e, tweetId, JSON.stringify(request))
        return tweetId; // Return tweetId even if there's an error
    }

    function getScorePair(mid) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = Date.now()
        sp.Member = mid
        return sp
    }

    function getFriendByAppCode(nodeAppCode) {
		if (!nodeAppCode) {
			// throw new Error("nodeAppCode is required")
            return hostId
		}
		console.log("nodeAppCode=", nodeAppCode)

		const fri = lapi.SessionGet(nodeAppCode, "nodeid")
		const forapp = lapi.SessionGet(nodeAppCode, "forapp")
		console.log("forapp=", forapp)
		console.log("appid=", APP_ID)

		if (APP_ID !== forapp) {
			throw new Error(`App ID mismatch: expected ${APP_ID}, got ${forapp}`)
		}
		return fri
	}
})(request, args)
