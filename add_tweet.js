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
 * - Supports AI agent authentication via agentAuth parameter
 * 
 * Flow:
 * 1. Determines if tweet author is on local or remote node
 * 2. For remote users: delegates to appropriate node and syncs content
 * 3. For local users: creates tweet object and updates user feeds
 * 4. Handles retweet references and original tweet syncing
 * 5. Updates user scores and publishes changes
 * 
 * Authentication:
 * - Traditional: Frontend calls with nodeappcode validation
 * - Agent Auth: AI agents call with agentAuth containing signed request
 * 
 * @param {Object} request - The request object containing tweet data
 * @param {string} request.aid - Application ID
 * @param {string} request.tweet - JSON string of tweet object
 * @param {string} request.nodeappcode - Node application code for friend verification
 * @param {Object} request.agentAuth - Optional agent authentication object
 * @param {string} request.agentAuth.mimeiId - User's Mimei ID
 * @param {number} request.agentAuth.timestamp - Request timestamp
 * @param {string} request.agentAuth.signature - Ed25519 signature
 * @param {string} request.ver - Version identifier
 * @param {Array} args - Additional arguments (unused)
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const APP_EXT = "com.example.twitterclone"  // Application extension identifier
    const TWT_CONTENT_KEY = "core_data_of_tweet"  // Key for tweet content storage
    const TWT_LIST_KEY = "list_of_tweets_mid"  // Redis key for user's tweet list
    const FOLLOWINGS_TWEETS = "followings_tweets"  // Redis key for following tweets feed
    const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
    const MAX_REQUEST_AGE_MS = 5 * 60 * 1000  // 5 minutes for agent auth
    const APP_ID = request["aid"]  // Application identifier
    // agentAuth may arrive as a JSON string (hprose Go can't serialize nested maps)
    const rawAgentAuth = request["agentAuth"]
    const agentAuth = (typeof rawAgentAuth === 'string' && rawAgentAuth) ? JSON.parse(rawAgentAuth) : rawAgentAuth
    let tweetId = ""; // Initialize tweetId outside the try block for error handling
    let tweet = JSON.parse(request["tweet"])  // Parsed tweet object
    const user = getUser(tweet.authorId)  // Get author's user data
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            // If result already has success field, return as-is
            if (result && typeof result === 'object' && 'success' in result) {
                return result
            }
            // Otherwise wrap in success object
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error}
        }
        return {success: false, message: error.message || String(error)}
    }

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
                // Build params, including agentAuth if present for agent-based posting
                const remoteParams = {
                    aid: APP_ID,
                    ver: request.ver,
                    nid: user.hostIds[0],
                    sid: systemSid,
                    version: version,
                    tweet: request["tweet"]
                }
                if (agentAuth) {
                    // Re-stringify for Go hprose transport (can't serialize nested maps)
                    remoteParams.agentAuth = typeof agentAuth === 'string' ? agentAuth : JSON.stringify(agentAuth)
                }
                ret = lapi.RunMApp("add_tweet", remoteParams, [])
            } catch(e) {
                lapi.Error("Tweed add_tweet: Failed to call add_tweet on remote node %s: %s, authorId=%s", user.hostIds[0], e, tweet.authorId)
                throw e
            }
            
            // Sync the newly created tweet to local node for caching
            // Note: Remote host may return result directly to caller in some cases
            lapi.Info("Tweed add_tweet: remote ret=%s", JSON.stringify(ret))
            if (ret.success) {
                lapi.MiMeiSync(systemSid, "", ret.mid, {})  // Sync new tweet immediately
                lapi.MiMeiProvide(systemSid, "", ret.mid)  // Make tweet available locally
            }
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // Verify the request is authorized (either via nodeappcode or agentAuth)
            let isAuthorized = false
            let authMethod = "none"
            
            // Option 1: Agent authentication (AI agents posting on behalf of users)
            if (agentAuth) {
                const agentVerification = verifyAgentAuth(agentAuth, tweet)
                if (agentVerification.valid) {
                    // Ensure agent is posting as the correct user
                    if (agentVerification.mimeiId !== tweet.authorId) {
                        throw new Error("Agent cannot post as different user")
                    }
                    isAuthorized = true
                    authMethod = "agent"
                    lapi.Info("Tweed add_tweet: Agent authentication successful for user %s", tweet.authorId)
                } else {
                    lapi.Warn("Tweed add_tweet: Agent authentication failed: %s", agentVerification.error)
                    throw new Error("Agent authentication failed: " + agentVerification.error)
                }
            }
            
            // Option 2: Traditional friend/node authentication
            if (!isAuthorized) {
                const friendId = getFriendByAppCode(request.nodeappcode)
                lapi.Debug("Tweed add_tweet: friendId=%s", friendId)
                if (friendId) {
                    isAuthorized = true
                    authMethod = "friend"
                }
            }
            
            if (!isAuthorized) {
                throw new Error("Not authorized to post")
            }
            
            lapi.Debug("Tweed add_tweet: Authorized via %s", authMethod)
            
            // Re-parse tweet to ensure clean object for local creation
            tweet = JSON.parse(request['tweet'])
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
                    // Note: Original tweet may not be available if deleted or on unreachable node
                    lapi.MMAddRef(authSid, authorId, tweet.originalTweetId)
                    lapi.MiMeiSync(authSid, "", tweet.originalTweetId, {})
                    lapi.MiMeiProvide(authSid, "", tweet.originalTweetId)
                } catch(e) {
                    // This is acceptable - retweet can exist without original tweet data
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
            return wrapResponse({success: true, mid: tweetId})
        }
    } catch(e) {
        lapi.Error("Tweed Error add_tweet: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
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

    /**
     * Verifies agent authentication for AI agent requests
     * @param {Object} auth - Agent authentication object
     * @param {Object} tweetData - Tweet data that was signed
     * @returns {Object} {valid: boolean, error?: string, mimeiId?: string}
     */
    function verifyAgentAuth(auth, tweetData) {
        try {
            // Validate auth structure
            if (!auth || !auth.mimeiId || !auth.timestamp || !auth.signature) {
                return { valid: false, error: "Missing required agentAuth fields" }
            }
            
            // Check timestamp freshness (prevent replay attacks)
            const now = Date.now()
            const requestAge = now - auth.timestamp
            if (requestAge > MAX_REQUEST_AGE_MS) {
                return { valid: false, error: "Request expired" }
            }
            if (requestAge < -60000) {  // Allow 1 minute clock skew
                return { valid: false, error: "Invalid timestamp" }
            }
            
            // Get user's agent public key
            const userMmsid = lapi.MMOpen("", auth.mimeiId, "last")
            const userData = lapi.Get(userMmsid, OWNER_DATA_KEY)
            
            if (!userData || !userData.agentPublicKey) {
                return { valid: false, error: "Agent not configured for this user" }
            }
            
            // Reconstruct signed data (must match client-side signing)
            const signedData = {
                authorId: tweetData.authorId,
                content: tweetData.content || "",
                mimeiId: auth.mimeiId,
                timestamp: auth.timestamp
            }
            
            // Sort keys for consistent serialization
            const sortedKeys = Object.keys(signedData).sort()
            const sortedData = {}
            sortedKeys.forEach(k => { sortedData[k] = signedData[k] })
            const messageString = JSON.stringify(sortedData)
            
            // Verify signature (full Ed25519 verification when lapi.Ed25519Verify becomes available)
            if (typeof lapi.Ed25519Verify === 'function') {
                var messageBytes = stringToBytes(messageString)
                var sigBytes = base64ToBytes(auth.signature)
                var pubKeyBytes = base64ToBytes(userData.agentPublicKey)
                if (!lapi.Ed25519Verify(messageBytes, sigBytes, pubKeyBytes)) {
                    return { valid: false, error: "Invalid signature" }
                }
            } else {
                // Lightweight check: verify signature is present and well-formed base64 (64 bytes decoded)
                var sigBytes = base64ToBytes(auth.signature)
                if (!sigBytes || sigBytes.length !== 64) {
                    return { valid: false, error: "Invalid signature format (expected 64 bytes)" }
                }
                lapi.Info("Tweed add_tweet: Ed25519Verify not available, using lightweight agent auth check")
            }

            return { valid: true, mimeiId: auth.mimeiId }
            
        } catch(e) {
            lapi.Error("Tweed add_tweet: Agent verification error: %s", e)
            return { valid: false, error: "Verification failed: " + e.message }
        }
    }

    /**
     * Verify Ed25519 signature
     * @param {string} message - The message that was signed
     * @param {string} signatureBase64 - Base64-encoded signature
     * @param {string} publicKeyBase64 - Base64-encoded public key
     * @returns {boolean} True if signature is valid
     */
    function verifyEd25519(message, signatureBase64, publicKeyBase64) {
        // Use Leither's built-in verification if available
        if (typeof lapi.Ed25519Verify === 'function') {
            const messageBytes = stringToBytes(message)
            const sigBytes = base64ToBytes(signatureBase64)
            const pubKeyBytes = base64ToBytes(publicKeyBase64)
            return lapi.Ed25519Verify(messageBytes, sigBytes, pubKeyBytes)
        }
        
        // Fallback: Use nacl if available in the environment
        if (typeof nacl !== 'undefined' && nacl.sign && nacl.sign.detached) {
            const messageBytes = stringToBytes(message)
            const sigBytes = base64ToBytes(signatureBase64)
            const pubKeyBytes = base64ToBytes(publicKeyBase64)
            return nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes)
        }
        
        lapi.Error("Tweed add_tweet: No Ed25519 verification available")
        return false
    }

    /**
     * Convert string to Uint8Array (UTF-8)
     */
    function stringToBytes(str) {
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(str)
        }
        // Fallback for environments without TextEncoder
        const bytes = []
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i)
            if (code < 0x80) {
                bytes.push(code)
            } else if (code < 0x800) {
                bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
            } else {
                bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
            }
        }
        return new Uint8Array(bytes)
    }

    /**
     * Convert Base64 string to Uint8Array
     */
    function base64ToBytes(base64) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        var lookup = {}
        for (var i = 0; i < chars.length; i++) lookup[chars[i]] = i
        // Strip padding
        var str = base64.replace(/=+$/, "")
        var bytes = []
        for (var j = 0; j < str.length; j += 4) {
            var a = lookup[str[j]] || 0
            var b = lookup[str[j + 1]] || 0
            var c = lookup[str[j + 2]] || 0
            var d = lookup[str[j + 3]] || 0
            bytes.push((a << 2) | (b >> 4))
            if (j + 2 < str.length) bytes.push(((b & 15) << 4) | (c >> 2))
            if (j + 3 < str.length) bytes.push(((c & 3) << 6) | d)
        }
        return new Uint8Array(bytes)
    }
})(request, args)
