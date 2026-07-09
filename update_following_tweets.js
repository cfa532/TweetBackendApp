/**
 * Check for new tweets from appUser's followings, and add them to
 * appUser's followings_tweets. If there are new tweets, sync them and
 * return them to the appUser.
 * 
 * `request.hostid` must be appUser.hostIds[0], the appUser's writable/home
 * host. That host is the single source of truth for list_of_followings_mid and
 * followings_tweets. Preferred callers should run this entry on hostIds[0].
 * If that home-host call returns new tweets, callers should run this entry a
 * second time on their current/access host with homeupdated=true so the current
 * host pulls the updated appUser mid from hostIds[0].
 *
 * The non-home-host branch below is retained as a compatibility fallback for
 * older callers, but it should not be the normal path.
 */

((request, args) => {
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const FOLLOWINGS_TWEETS = "followings_tweets"   // sorted set of followings' tweets
    const FOLLOWINGS_LIST = "list_of_followings_mid"
    const TWT_LIST_KEY = "list_of_tweets_mid"   // sorted set of user's own tweets
    
    // Extract request parameters
    const APP_ID = request["aid"]
    const userId = request["appuserid"]    // appUser
    const hostId = request["hostid"]   // appUser.hostIds[0], the writable/home host
    const homeUpdated = request["homeupdated"] === true || request["homeupdated"] === "true"
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            // If result already has success field, return as-is
            if (result && typeof result === 'object' && 'success' in result) {
                return result
            }
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error}
        }
        return {success: false, error: error.message}
    }
    
    // Initialize authentication and get current node ID
    const authSid = lapi.BELoginAsAuthor()
    const nodeId = lapi.GetVar("", "hostid")    // current node id

    try {
        // Get user session and find the last tweet score before any sync. On
        // current/access hosts this is the local high-water mark; after pulling
        // from hostIds[0], entries above this score are the new tweets to return.
        let userSid = lapi.MMOpen(authSid, userId, "last")
        const lastElements = lapi.Zrevrange(userSid, FOLLOWINGS_TWEETS, 0, 0)
        const lastScore = lastElements.length > 0 ? lastElements[0].Score + 1 : 0

        if (nodeId !== hostId) {
            // Compatibility fallback: this entry is running on a host other than
            // appUser.hostIds[0]. Ask hostIds[0], the source of truth, to update
            // followings_tweets unless the caller already did that first pass.
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

            if (!homeUpdated) {
                // Send the request to appUser.hostIds[0].
                const ret = lapi.RunMApp("update_following_tweets", {
                    aid: APP_ID,
                    ver: "last",
                    nid: hostId,
                    sid: systemSid,
                    version: version,
                    hostid: hostId,
                    appuserid: userId
                }, [])
                lapi.Debug("Tweed update_following_tweets: ret from home host %s", JSON.stringify(ret))
            }
            
            // Get the updated appUser score from appUser.hostIds[0].
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
            
            // Legacy local pull. This is best-effort only; preferred callers
            // perform the pull explicitly after the hostIds[0] update completes.
            const localScore = lapi.Zscore(systemSid, userId, userId)
            lapi.Debug("Tweed update_following_tweets: remoteScore=%s, localScore=%s", JSON.stringify(remoteScore), String(localScore))
            
            if (remoteScore !== localScore) {
                if (remoteScore === null || remoteScore === undefined || typeof remoteScore === "object") {
                    throw new Error(`Invalid remote score from host ${hostId}: ${JSON.stringify(remoteScore)}`)
                }
                lapi.MiMeiSync(systemSid, "", userId, {SourcePeer: hostId})
                // update the score of the user in local AppData
                const sp = getScorePair(remoteScore, userId)
                lapi.Zadd(systemSid, userId, sp)
            }

            // Get new tweets since the last processed score

            // Reopen after pulling appUser from hostIds[0]; otherwise a stale
            // session can miss the freshly synced followings_tweets entries.
            userSid = lapi.MMOpen(authSid, userId, "last")
            const arr = lapi.Zrangebyscore(userSid, FOLLOWINGS_TWEETS, lastScore, Date.now(), 0, 1000)
            lapi.Debug("Tweed update_following_tweets: new tweets, lastScore=%s, arr=%s", String(lastScore), JSON.stringify(arr))
            
            // Fetch tweet details for each new tweet
            const tweets = []
            for (const e of arr) {
                const tweetId = e.Member
                let tweetResp = lapi.RunMApp("get_tweet", {
                    aid: APP_ID,
                    ver: "last",
                    version: 'v2',
                    appuserid: userId,
                    tweetid: tweetId
                }, [])
                let tweet = tweetResp?.success ? tweetResp.data : null

                if (tweet) {
                    tweets.push(tweet)
                }
            }

            return wrapResponse({
                success: true,
                tweets: tweets,
                originalTweets: []
            })
        } else {
            // This host is the single source of truth, process followings directly.
            const mmsid = lapi.MMOpen(authSid, userId, "cur")
            const followings = lapi.Hkeys(mmsid, FOLLOWINGS_LIST) // mid list of its followings
            lapi.Debug("Tweed update_following_tweets: root, followings=%s", JSON.stringify(followings))

            // Process each following to get their new tweets
            const tweets = []
            for (const uid of followings) {
                // sync followings' data if there is any new tweet
                tweets.push(...updateUser(uid, lastScore, mmsid))
            }
        
            lapi.Debug("Tweed update_following_tweets: root new tweets %s", JSON.stringify(tweets))
            
            // If we found new tweets, backup and publish the changes
            if (tweets.length > 0) {
                lapi.MMBackup(mmsid, userId, "", "delref=true")
                lapi.MiMeiPublish(mmsid, "", userId)
            }
            
            return wrapResponse({
                success: true,
                tweets: tweets,
                originalTweets: []
            })
        }
    } catch(e) {
        lapi.Error("Tweed Error update_following_tweets: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
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
            let mmsid = lapi.MMOpen("", uid, "last")
            const user = lapi.Get(mmsid, OWNER_DATA_KEY)
            
            if (!user) {
                lapi.Error("Tweed update_following_tweets: updateUser: user not found, uid=%s, nodeId=%s", uid, nodeId)
                return []
            }

            const sourceHostId = user.hostIds && user.hostIds.length > 0 ? user.hostIds[0] : null

            // Pull the followed user's latest published state from their home
            // host before reading list_of_tweets_mid. Child tweet mids are synced by the system.
            if (sourceHostId) {
                try {
                    lapi.RunMApp("node_update_mid_by_score", {
                        aid: APP_ID, 
                        ver: "last",
                        hostid: sourceHostId, 
                        userid: uid, 
                        mid: uid
                    }, [])
                } catch(e) {
                    lapi.Error("Tweed update_following_tweets: Failed to update user score: %s, uid=%s, hostId=%s", e, uid, sourceHostId)
                    // Don't throw - continue processing
                }
            }

            // Reopen after node_update_mid_by_score so list_of_tweets_mid is read
            // from the freshly synced local copy.
            mmsid = lapi.MMOpen("", uid, "last")
            
            // Get new tweets since lastScore by the uid
            const arr = lapi.Zrangebyscore(mmsid, TWT_LIST_KEY, lastScore, Date.now(), 0, 1000)
            lapi.Debug("Tweed update_following_tweets: updateUser: arr=%s, lastScore=%s, uid=%s", JSON.stringify(arr), String(lastScore), uid)
            
            // Add new tweets to the followings_tweets sorted set
            if (arr.length > 0) {
                lapi.Zadd(userSid, FOLLOWINGS_TWEETS, ...arr)
            }
            
            // Fetch tweet details for each new tweet
            const tweets = []
            for (const e of arr) {
                const tweetId = e.Member
                let tweetResp = lapi.RunMApp("get_tweet", {
                    aid: APP_ID,
                    ver: "last",
                    version: 'v2',
                    appuserid: userId,
                    tweetid: tweetId
                }, [])
                let tweet = tweetResp?.success ? tweetResp.data : null

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
