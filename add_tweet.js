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
        
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // Delegate tweet creation to the node hosting the author
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

            const ret = lapi.RunMApp("add_tweet", {aid: APP_ID, ver: request.ver,
                nid: user.hostIds[0], sid: systemSid,
                tweet: request["tweet"]}, []
            )
            
            // Sync the newly created tweet to local node for caching
            // Note: Remote host may return result directly to caller in some cases
            console.log("add_tweet remote ret=", JSON.stringify(ret))
            try {
                if (ret.success) {
                    lapi.MiMeiSync(systemSid, "", ret.mid, {})  // Sync new tweet immediately
                    lapi.MiMeiProvide(systemSid, "", ret.mid)  // Make tweet available locally
                }
            } catch(e) {
                console.error("Error add_tweet: remote not ready.", e, JSON.stringify(ret), JSON.stringify(request))
            }
            return ret
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // Verify the request is from an authorized friend/node
            const friendId = getFriendByAppCode(request.nodeappcode)
            console.log("add_tweet: friendId=", friendId)
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
                lapi.MMAddRef(authSid, tweetId, element.mid)  // Add reference to attachment
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
                    console.error("add_tweet: Error sync original tweet", e, JSON.stringify(tweet))
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
            console.log("add_tweet local", JSON.stringify(tweet))
            return {success: true, mid: tweetId}
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error add_tweet", e, JSON.stringify(request))
        return {success: false, message: e}
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Retrieves user data from the system
     * @param {string} mid - User ID to retrieve data for
     * @returns {Object|null} User data object or null if not found
     */
    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
        const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
        return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
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
		console.log("nodeAppCode=", nodeAppCode)

		// Retrieve node ID and app ID from session
		const fri = lapi.SessionGet(nodeAppCode, "nodeid")
		const forapp = lapi.SessionGet(nodeAppCode, "forapp")
		console.log("forapp=", forapp)
		console.log("appid=", APP_ID)

		// Validate app ID matches expected application
		if (APP_ID !== forapp) {
			throw new Error(`App ID mismatch: expected ${APP_ID}, got ${forapp}`)
		}
		return fri
	}
})(request, args)
