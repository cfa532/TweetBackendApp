/**
 * Update Tweet Privacy Function
 * 
 * This function updates the privacy settings of a tweet by toggling the isPrivate property.
 * It handles both local and remote tweet privacy updates, ensuring only tweet authors
 * can modify their content's privacy settings.
 * 
 * Key Features:
 * - Toggles tweet privacy (public/private)
 * - Handles both local and remote tweet updates
 * - Validates tweet authorship before allowing changes
 * - Syncs changes across the distributed network
 * - Updates tweet content and publishes changes
 * 
 * @param {Object} request - The request object containing privacy update data
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user requesting privacy update
 * @param {string} request.tweetid - ID of tweet to update privacy for
 * @param {Array} args - Additional arguments (unused)
 * @returns {boolean} New privacy status (true for private, false for public)
 */
((request, args) => {
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const TWT_CONTENT_KEY = "core_data_of_tweet"  // Key for tweet content storage
    const APP_ID = request["aid"]  // Application identifier
    const appUserId = request["appuserid"]  // ID of user requesting privacy update
    const tweetId = request["tweetid"]  // ID of tweet to update privacy for

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // Get user data to determine primary host
        const user = getUser(appUserId)
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed update_tweet_privacy: missing host for user %s", JSON.stringify({appUserId, nodeId, user}))
            throw new Error("User not found or missing host")
        }

        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        // Check if we need to delegate to the user's primary host
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // Delegate privacy update to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

            let ret
            try {
                ret = lapi.RunMApp("update_tweet_privacy", {
                    aid: APP_ID, 
                    ver: "last",
                    nid: user.hostIds[0], 
                    sid: systemSid,
                    appuserid: appUserId, 
                    tweetid: tweetId
                }, [])
            } catch(e) {
                lapi.Error("Tweed update_tweet_privacy: Failed to call update_tweet_privacy on remote node %s: %s, appUserId=%s, tweetId=%s", user.hostIds[0], e, appUserId, tweetId)
                throw e
            }
            
            lapi.Debug("Tweed update_tweet_privacy: remote ret=%s", JSON.stringify(ret))
            
            try {
                if (typeof ret === 'boolean') {
                    // Remote call returned boolean directly - sync the updated tweet
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                    return ret
                }
            } catch(e) {
                lapi.Error("Tweed update_tweet_privacy: remote sync failed: %s, ret=%s, request=%s", e, JSON.stringify(ret), JSON.stringify(request))
            }
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // We are on the user's primary host, perform the update locally
            const authSid = lapi.BELoginAsAuthor()
            
            // Open the tweet for editing
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
            
            if (!tweet) {
                throw new Error("Tweet not found")
            }
            
            // ================================================================
            // AUTHORSHIP VALIDATION
            // ================================================================
            
            // Verify the user is the author of the tweet
            if (tweet.authorId !== appUserId) {
                throw new Error("Only the tweet author can update privacy settings")
            }
            
            // ================================================================
            // PRIVACY UPDATE
            // ================================================================
            
            // Toggle the isPrivate property
            tweet.isPrivate = !tweet.isPrivate
            
            // Update the tweet in storage and publish changes
            lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)
            
            lapi.Debug("Tweed update_tweet_privacy: local tweet=%s", JSON.stringify(tweet))
            return tweet.isPrivate ? true : false
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error update_tweet_privacy: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
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
        try {
            const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
            const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
            return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
        } catch(e) {
            lapi.Error("Tweed update_tweet_privacy: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)
