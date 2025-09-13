/**
 * Add a new tweet to the local host.
 */
((request, args)=>{
    const APP_EXT = "com.example.twitterclone"
    const TWT_CONTENT_KEY = "core_data_of_tweet" 
    const TWT_LIST_KEY = "list_of_tweets_mid"
    const FOLLOWINGS_TWEETS = "followings_tweets"
    const APP_ID = request["aid"]
    let tweetId = ""; // Initialize tweetId outside the try block
    let tweet = JSON.parse(request["tweet"])
    const user = getUser(tweet.authorId)

    try {
        let nodeId = lapi.GetVar("", "hostid")    // current node id
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

            const ret = lapi.RunMApp("add_tweet", {aid: APP_ID, ver: request.ver,
                nid: user.hostIds[0], sid: systemSid,
                tweet: request["tweet"]}, []
            )
            // tweet is created on remote host, sync it here.
            // TODO: the returned value is null. It seems the remote host returned
            // result directly to the caller.
            console.log("add_tweet remote ret=", JSON.stringify(ret))
            try {
                if (ret.success) {
                    lapi.MiMeiSync(systemSid, "", ret.mid, {})  // Get new tweet right away.
                    lapi.MiMeiProvide(systemSid, "", ret.mid)
                }
            } catch(e) {
                console.error("Error add_tweet: remote not ready.", e, JSON.stringify(ret), JSON.stringify(request))
            }
            return ret
        } else {
            const friendId = getFriendByAppCode(request.nodeappcode)
            console.log("add_tweet: friendId=", friendId)
            if (!friendId) {
                throw new Error("Not a friend of the host")
            }
            const tweet = JSON.parse(request['tweet'])
            const authSid = lapi.BELoginAsAuthor()
            tweetId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            tweet["mid"] = tweetId
            tweet["timestamp"] = Date.now()    
            lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)
    
            tweet.attachments?.forEach(element => {
                element.timestamp = Number(element.timestamp)
                lapi.MMAddRef(authSid, tweetId, element.mid)
            });
            lapi.MMBackup(authSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)     // publish the tweet ID.
    
            const authorId = tweet.authorId
            const userSid = lapi.MMOpen(authSid, authorId, "cur")
            const sp = getScorePair(tweetId)
            lapi.Zadd(userSid, TWT_LIST_KEY, sp)
            lapi.Zadd(userSid, FOLLOWINGS_TWEETS, sp)
    
            lapi.MMAddRef(authSid, authorId, tweetId)
            lapi.MMBackup(authSid, authorId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", authorId)
    
            // update the score of the author and the new tweet in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: tweet.authorId, mid: tweetId}, [])
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: tweet.authorId, mid: authorId}, [])

            // if the tweet is a retweet of an original tweet, sync the original tweet here.
            if (tweet.originalTweetId) {
                try {
                    // if (!lapi.MFIsExist("", tweet.originalTweetId)) {
                        lapi.MiMeiSync(authSid, "", tweet.originalTweetId, {})
                        lapi.MiMeiProvide(authSid, "", tweet.originalTweetId)
                    // }
                } catch(e) {
                    console.error("add_tweet: Error sync original tweet", e, JSON.stringify(tweet))
                }
            }
            console.log("add_tweet local", JSON.stringify(tweet))
            return {success: true, mid: tweetId}
        }
    } catch(e) {
        console.error("Error add_tweet", e, JSON.stringify(request))
        return {success: false, message: e}
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
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
            // The function is called by the frontend, not the peer.
			// throw new Error("nodeAppCode is required")
            return user.hostIds[0]
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
