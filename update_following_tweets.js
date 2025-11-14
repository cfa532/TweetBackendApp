/**
 * Check for new tweets from appUser's followings, and add them to
 * appUser's followings_tweets. If there are new tweets, sync them and
 * return them to the appUser.
 * 
 * This function handles both local and remote execution:
 * - When called locally: delegates to remote host and processes results
 * - When called remotely: processes followings and returns new tweets
 */

((request, args) => {
    // Constants for data storage keys
    const FOLLOWINGS_TWEETS = "followings_tweets"   // sorted set of followings' tweets
    const FOLLOWINGS_LIST = "list_of_followings_mid"
    const TWT_LIST_KEY = "list_of_tweets_mid"   // sorted set of user's own tweets
    
    // Extract request parameters
    const APP_ID = request["aid"]
    const userId = request["appuserid"]    // appUser
    const hostId = request["hostid"]
    
    // Initialize authentication and get current node ID
    const authSid = lapi.BELoginAsAuthor()
    const nodeId = lapi.GetVar("", "hostid")    // current node id

    try {
        // Get user session and find the last tweet score
        const userSid = lapi.MMOpen(authSid, userId, "last")
        const lastElements = lapi.Zrevrange(userSid, FOLLOWINGS_TWEETS, 0, 0)
        const lastScore = lastElements.length > 0 ? lastElements[0].Score + 1 : 0

        if (nodeId !== hostId) {
            // We are on a local node, delegate to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            
            // Send the request to the remote host
            const ret = lapi.RunMApp("update_following_tweets", {
                aid: APP_ID, 
                ver: "last",
                nid: hostId, 
                sid: systemSid,
                hostid: hostId, 
                appuserid: userId
            }, [])
            lapi.Debug("Tweed update_following_tweets: ret from remote host %s", JSON.stringify(ret))
            
            // Get the updated score from the remote host
            let remoteScore
            try {
                remoteScore = lapi.RunMApp("node_get_score", { 
                    aid: APP_ID, 
                    ver: request.ver,
                    nid: hostId,        // remote host id
                    sid: systemSid,     // necessary to prove the user's authenticity
                    userid: userId, 
                    mid: userId
                }, [])
            } catch(e) {
                lapi.Error("Tweed update_following_tweets: Failed to get remote score: %s, userId=%s, hostId=%s", e, userId, hostId)
                throw e
            }
            
            // Compare with local score and sync if different
            const localScore = lapi.Zscore(systemSid, userId, userId)
            lapi.Debug("Tweed update_following_tweets: remoteScore=%s, localScore=%s", remoteScore, localScore)
            
            if (remoteScore !== localScore) {
                lapi.MiMeiSync(systemSid, "", userId, {})
                // update the score of the user in local AppData
                const sp = getScorePair(remoteScore, userId)
                lapi.Zadd(systemSid, userId, sp)
            }

            // Get new tweets since the last processed score
            const arr = lapi.Zrangebyscore(userSid, FOLLOWINGS_TWEETS, lastScore, Date.now(), 0, 1000)
            lapi.Debug("Tweed update_following_tweets: new tweets, lastScore=%s, arr=%s", lastScore, JSON.stringify(arr))
            
            // Fetch tweet details for each new tweet
            const tweets = []
            for (const e of arr) {
                const tweetId = e.Member
                let tweet = lapi.RunMApp("get_tweet", {
                    aid: APP_ID, 
                    ver: "last",
                    appuserid: userId, 
                    tweetid: tweetId
                }, [])
                
                if (tweet) {
                    tweets.push(tweet)
                } else {
                    // Tweet not found locally, try to sync and fetch again
                    lapi.MiMeiSync(userSid, "", tweetId, {})
                    tweet = lapi.RunMApp("get_tweet", {
                        aid: APP_ID, 
                        ver: "last",
                        appuserid: userId, 
                        tweetid: tweetId
                    }, [])
                    
                    if (tweet) {
                        tweets.push(tweet)
                    }
                }
            }

            return {
                success: true,
                tweets: tweets,
                originalTweets: []
            }
        } else {
            // This host is the single source of truth, process followings directly.
            const mmsid = lapi.MMOpen(authSid, userId, "cur")
            const followings = lapi.Hkeys(mmsid, FOLLOWINGS_LIST) // mid list of its followings
            lapi.Debug("Tweed update_following_tweets: remote, followings=%s", JSON.stringify(followings))

            // Process each following to get their new tweets
            const tweets = []
            for (const uid of followings) {
                // sync followings' data if there is any new tweet
                tweets.push(...updateUser(uid, lastScore, mmsid))
            }
        
            lapi.Debug("Tweed update_following_tweets: remote new tweets %s", JSON.stringify(tweets))
            
            // If we found new tweets, backup and publish the changes
            if (tweets.length > 0) {
                lapi.MMBackup(mmsid, userId, "", "delref=true")
                lapi.MiMeiPublish(mmsid, "", userId)
            }
            
            return {
                success: true,
                tweets: tweets,
                originalTweets: []
            }
        }
    } catch(e) {
        lapi.Error("Tweed Error update_following_tweets: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return {
            success: false,
            error: e.message
        }
    }

    /**
     * Updates a specific user's tweets and adds new ones to the followings_tweets list
     * This function is called by the remote host to process individual followings
     * 
     * @param {string} uid - The user ID to update
     * @param {number} lastScore - The last processed score timestamp
     * @param {string} userSid - The user session ID
     * @returns {Array} Array of new tweets from the user
     */
    function updateUser(uid, lastScore, userSid) {
        try {
            const OWNER_DATA_KEY = "data_of_author"
            const mmsid = lapi.MMOpen("", uid, "last")
            const user = lapi.Get(mmsid, OWNER_DATA_KEY)
            
            if (!user) {
                lapi.Error("Tweed update_following_tweets: updateUser: user not found, uid=%s, nodeId=%s", uid, nodeId)
                return []
            }
            
            // Update the user's score if they have host IDs
            if (user.hostIds && user.hostIds.length > 0) {
                try {
                    lapi.RunMApp("node_update_mid_by_score", {
                        aid: APP_ID, 
                        ver: "last",
                        hostid: user.hostIds[0], 
                        userid: uid, 
                        mid: uid
                    }, [])
                } catch(e) {
                    lapi.Error("Tweed update_following_tweets: Failed to update user score: %s, uid=%s, hostId=%s", e, uid, user.hostIds[0])
                    // Don't throw - continue processing
                }
            }
            
            // Get new tweets since lastScore by the uid
            const arr = lapi.Zrangebyscore(mmsid, TWT_LIST_KEY, lastScore, Date.now(), 0, 1000)
            lapi.Debug("Tweed update_following_tweets: updateUser: arr=%s, lastScore=%s, uid=%s", JSON.stringify(arr), lastScore, uid)
            
            // Add new tweets to the followings_tweets sorted set
            if (arr.length > 0) {
                lapi.Zadd(userSid, FOLLOWINGS_TWEETS, ...arr)
            }
            
            // Fetch tweet details for each new tweet
            const tweets = []
            for (const e of arr) {
                const tweetId = e.Member
                const tweet = lapi.RunMApp("get_tweet", {
                    aid: APP_ID, 
                    ver: "last",
                    appuserid: userId, 
                    tweetid: tweetId
                }, [])
                
                if (tweet) {
                    tweets.push(tweet)
                }
            }
            
            return tweets
        } catch(e) {
            lapi.Error("Tweed update_following_tweets: updateUser error: %s, uid=%s", e, uid)
            return []
        }
    }

    /**
     * Creates a score pair object for storing in sorted sets
     * @param {number} score - The score value
     * @param {string} member - The member identifier
     * @returns {Object} ScorePair object with Score and Member properties
     */
    function getScorePair(score, member) {
        function ScorePair() {}
        const sp = new ScorePair()
        sp.Score = score ? score : 0
        sp.Member = member
        return sp
    }
})(request, args)