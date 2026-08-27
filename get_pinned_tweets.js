/**
 * Get Pinned Tweets Function
 * 
 * This function retrieves the list of pinned tweets for a specific user.
 * Pinned tweets are displayed at the top of a user's profile and are
 * returned with their pinning timestamp.
 * 
 * Key Features:
 * - Retrieves pinned tweets with pinning timestamps
 * - Returns complete tweet objects with metadata
 * - Filters out invalid or missing tweets
 * - Cleans up stale (no-longer-existing) tweetIds from PINNED_TWEETS when
 *   this node is userId's write/home node
 * - Handles error cases gracefully
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user requesting pinned tweets
 * @param {string} request.userid - ID of user whose pinned tweets to retrieve
 * @param {Array} args - Additional arguments (unused)
 * @returns {Array} Array of objects containing tweet and pinning timestamp
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error, data: []}
        }
        return []
    }
    
    try {
        const PINNED_TWEETS = "pinned_tweet_list"  // Redis key for user's pinned tweets
        const appUserId = request["appuserid"]  // ID of user requesting pinned tweets
        const userId = request["userid"]  // ID of user whose pinned tweets to retrieve
        const mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space

        // ========================================================================
        // WRITE SESSION (home node only — needed to clean up stale entries)
        // ========================================================================

        // Only safe to delete stale tweetIds from PINNED_TWEETS when this node
        // is confirmed to be userId's write/home node (hostIds[0]) — deleting
        // from a stale replica would not be authoritative. Failure here must
        // not break the pinned-tweets response itself, so it's isolated in
        // its own try/catch and simply falls back to skipping cleanup.
        let isHomeNode = false
        try {
            const owner = lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver: "last",
                userid: userId}, [])
            isHomeNode = !!(owner?.hostIds?.[0] && owner.hostIds[0] === owner.hostIds[1])
        } catch (e) {
            lapi.Error("Tweed get_pinned_tweets: get_user_core_data failed for userId=%s: %s", userId, e)
        }

        let authSid = null
        let userSid = null
        if (isHomeNode) {
            try {
                authSid = lapi.BELoginAsAuthor()
                userSid = lapi.MMOpen(authSid, userId, "cur")
            } catch (e) {
                lapi.Error("Tweed get_pinned_tweets: failed to open write session for userId=%s: %s", userId, e)
                authSid = null
                userSid = null
                isHomeNode = false
            }
        }

        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================

        const staleTweetIds = []

        // Get pinned tweet IDs and convert to full tweet objects with timestamps
        const result = lapi.Hkeys(mmsid, PINNED_TWEETS).map(tweetId => {
            let ts = lapi.Hget(mmsid, PINNED_TWEETS, tweetId).toString()  // Pinning timestamp
            const tweetResp = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                version: 'v2', appuserid: appUserId, tweetid: tweetId}, [])
            let tweet = tweetResp?.success ? tweetResp.data : null
            if (tweet) {
                // Note: timestamp is when the tweet was pinned, not its creation time
                return {tweet: tweet, timestamp: ts}
            }
            // Tweet no longer exists — queue for removal from PINNED_TWEETS.
            if (isHomeNode) staleTweetIds.push(tweetId)
        }).filter(e=> e);  // Remove null/undefined results

        // Remove stale tweetIds from PINNED_TWEETS. Best-effort: a failure
        // here must not break the pinned-tweets response, since the result
        // was already built successfully above.
        if (isHomeNode && userSid && staleTweetIds.length > 0) {
            try {
                staleTweetIds.forEach(tweetId => {
                    lapi.Warn("Tweed get_pinned_tweets: removing stale tweetId=%s from PINNED_TWEETS, userId=%s", tweetId, userId)
                    lapi.Hdel(userSid, PINNED_TWEETS, tweetId)
                })
                lapi.MMBackup(userSid, userId, "", "delref=false")
                lapi.MiMeiPublish(authSid, "", userId)
                lapi.Warn("Tweed get_pinned_tweets: removed %d stale tweetId(s) from PINNED_TWEETS, userId=%s",
                    staleTweetIds.length, userId)
            } catch (e) {
                lapi.Error("Tweed get_pinned_tweets: failed to remove stale tweetIds for userId=%s: %s", userId, e)
            }
        }

        return wrapResponse(result)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_pinned_tweets: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)