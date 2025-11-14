/**
 * Add Tweet Function
 * 
 * This function creates a new tweet in a distributed social media system.
 * It handles both local and remote user tweet creation, managing content
 * distribution across nodes in the network.
 * 
 * Key Features:
 * - Handles local and remote user tweet creation
 * - Manages tweet attachments and references
 * - Supports retweets (quoted tweets)
 * - Updates user feeds and following lists
 * - Syncs content across distributed nodes
 * 
 * Flow:
 * 1. Determines if tweet author is on local or remote node
 * 2. For remote users: delegates to appropriate node and syncs content
 * 3. For local users: creates tweet object and updates user feeds
 * 4. Handles retweet references and original tweet syncing
 * 5. Updates user scores and publishes changes
 * 
 * @param {Object} request - The request object containing tweet data
 * @param {string} request.aid - Application ID
 * @param {string} request.tweet - JSON string of tweet object
 * @param {string} request.nodeappcode - Node application code for friend verification
 * @param {string} request.ver - Version identifier
 * @param {Array} args - Additional arguments (unused)
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const APP_EXT = "com.example.twitterclone"  // Application extension identifier
    const TWT_CONTENT_KEY = "core_data_of_tweet"  // Key for tweet content storage
    const TWT_LIST_KEY = "list_of_tweets_mid"  // Redis key for user's tweet list
    const FOLLOWINGS_TWEETS = "followings_tweets"  // Redis key for following tweets feed
    const APP_ID = request["aid"]  // Application identifier
    let tweetId = ""; // Initialize tweetId outside the try block for error handling
    let tweet = JSON.parse(request["tweet"])  // Parsed tweet object
    const user = getUser(tweet.authorId)  // Get author's user data

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        let nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed add_tweet: missing host for user %s", JSON.stringify({authorId: tweet.authorId, nodeId}))
            throw new Error("User host not found")
        }

        if (user.hostIds[0] !== nodeId) {
            // Delegate tweet creation to the node hosting the author
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

            let ret
            try {
                ret = lapi.RunMApp("add_tweet", {aid: APP_ID, ver: request.ver,
                    nid: user.hostIds[0], sid: systemSid,
                    tweet: request["tweet"]}, []
                )
            } catch(e) {
                lapi.Error("Tweed add_tweet: Failed to call add_tweet on remote node %s: %s, authorId=%s", user.hostIds[0], e, tweet.authorId)
                throw e
            }
            
            // Sync the newly created tweet to local node for caching
            // Note: Remote host may return result directly to caller in some cases
            lapi.Info("Tweed add_tweet: remote ret=%s", JSON.stringify(ret))
            try {
                if (ret.success) {
                    lapi.MiMeiSync(systemSid, "", ret.mid, {})  // Sync new tweet immediately
                    lapi.MiMeiProvide(systemSid, "", ret.mid)  // Make tweet available locally
                }
            } catch(e) {
                lapi.Error("Tweed add_tweet: remote not ready: %s, ret=%s, request=%s", e, JSON.stringify(ret), JSON.stringify(request))
            }
            return ret
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // Verify the request is from an authorized friend/node
            const friendId = getFriendByAppCode(request.nodeappcode)
            lapi.Debug("Tweed add_tweet: friendId=%s", friendId)
            if (!friendId) {
                throw new Error("Not a friend of the host")
            }
            
            // Create the tweet object
            const tweet = JSON.parse(request['tweet'])
            const authSid = lapi.BELoginAsAuthor()
            tweetId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            tweet["mid"] = tweetId  // Set the tweet's unique identifier
            tweet["timestamp"] = Date.now()  // Set creation timestamp
            lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)  // Store tweet content
    
            // Process tweet attachments (images, videos, etc.)
            tweet.attachments?.forEach(element => {
                element.timestamp = Number(element.timestamp)  // Ensure timestamp is numeric
                lapi.MMAddRef(authSid, tweetId, element.mid)  // Add reference to parent tweet
            });
            
            // Backup tweet data and publish it
            lapi.MMBackup(authSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)  // Make tweet available to other nodes
    
            // Add tweet to author's tweet list and following feed
            const authorId = tweet.authorId
            const userSid = lapi.MMOpen(authSid, authorId, "cur")
            const sp = getScorePair(tweetId)  // Create score pair for chronological ordering
            lapi.Zadd(userSid, TWT_LIST_KEY, sp)  // Add to user's personal tweet list
            lapi.Zadd(userSid, FOLLOWINGS_TWEETS, sp)  // Add to following tweets feed
    
            // Handle retweets (quoted tweets with original tweet references)
            if (tweet.originalTweetId) {
                try {
                    // Create reference to original tweet and sync it locally
                    lapi.MMAddRef(authSid, authorId, tweet.originalTweetId)
                    lapi.MiMeiSync(authSid, "", tweet.originalTweetId, {})
                    lapi.MiMeiProvide(authSid, "", tweet.originalTweetId)
                } catch(e) {
                    lapi.Error("Tweed add_tweet: Error sync original tweet: %s, tweet=%s", e, JSON.stringify(tweet))
                }
            }
            // Create reference from author to tweet and update author data
            lapi.MMAddRef(authSid, authorId, tweetId)
            lapi.MMBackup(authSid, authorId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", authorId)  // Publish updated author data
    
            // Update the author's score in application data
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: tweet.authorId, mid: authorId}, [])

            // Return success response with tweet ID
            lapi.Info("Tweed add_tweet: local %s", JSON.stringify(tweet))
            return {success: true, mid: tweetId}
        }
    } catch(e) {
        lapi.Error("Tweed Error add_tweet: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return {success: false, message: e}
    }

    /**
     * Retrieves user data from the system
     * @param {string} mid - User ID to retrieve data for
     * @returns {Object|null} User data object or null if not found
     */
    function getUser(mid) {
        try {
            const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
            const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
            return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
        } catch(e) {
            lapi.Error("Tweed add_tweet: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }

    /**
     * Creates a score pair object for Redis sorted set operations
     * @param {string} mid - The member ID to associate with the score
     * @returns {Object} ScorePair object with timestamp score and member ID
     */
    function getScorePair(mid) {
        function ScorePair() {}
        const sp = new ScorePair()
        sp.Score = Date.now()  // Use current timestamp as score for chronological ordering
        sp.Member = mid  // The ID of the tweet
        return sp
    }

    /**
     * Validates and retrieves friend node ID from application code
     * @param {string} nodeAppCode - Application code for friend verification
     * @returns {string} Friend node ID or user's host ID if called from frontend
     * @throws {Error} If app ID mismatch or invalid node app code
     */
    function getFriendByAppCode(nodeAppCode) {
		if (!nodeAppCode) {
            // Called from frontend, not a peer node - use user's host ID
			return user.hostIds[0]
		}
		lapi.Trace("Tweed add_tweet: nodeAppCode=%s", nodeAppCode)

		// Retrieve node ID and app ID from session
		const fri = lapi.SessionGet(nodeAppCode, "nodeid")
		const forapp = lapi.SessionGet(nodeAppCode, "forapp")
		lapi.Trace("Tweed add_tweet: forapp=%s", forapp)
		lapi.Trace("Tweed add_tweet: appid=%s", APP_ID)

		// Validate app ID matches expected application
		if (APP_ID !== forapp) {
			throw new Error(`App ID mismatch: expected ${APP_ID}, got ${forapp}`)
		}
		return fri
	}
})(request, args)
