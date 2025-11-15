/**
 * Delete Tweet Function
 * 
 * This function deletes a tweet from a distributed social media system.
 * It handles both local and remote tweet deletion, with different behaviors
 * for tweet authors versus other users.
 * 
 * Key Features:
 * - Handles both local and remote tweet deletion
 * - Only tweet authors can permanently delete tweets
 * - Other users can only remove tweets from their personal lists
 * - Manages tweet attachments and references
 * - Updates user feeds and pinned tweet lists
 * 
 * Flow:
 * 1. Determines if user is on local or remote node
 * 2. For remote users: delegates to appropriate node
 * 3. For local users: checks if user is tweet author
 * 4. Authors: permanently delete tweet and attachments
 * 5. Others: remove from personal lists only
 * 6. Update user scores and publish changes
 * 
 * @param {Object} request - The request object containing deletion data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user requesting deletion
 * @param {string} request.tweetid - ID of tweet to delete
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const TWT_LIST_KEY = "list_of_tweets_mid"  // Redis key for user's tweet list
    const TWT_CONTENT_KEY = "core_data_of_tweet"  // Key for tweet content storage
    const FOLLOWINGS_TWEETS = "followings_tweets"  // Redis key for following tweets feed
    const PINNED_TWEETS = "pinned_tweet_list"  // Redis key for pinned tweets list
    const tweetId = request["tweetid"]  // ID of tweet to be removed
    const userId = request["userid"]  // ID of user requesting deletion
    const APP_ID = request["aid"]  // Application identifier
    
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
        return {message: error, success: false}
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const user = getUser(userId)  // Get user data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed delete_tweet: missing host for user %s", JSON.stringify({userId, nodeId, user}))
            throw new Error("User host not found")
        }

        if (user.hostIds[0] !== nodeId) {
            // Delegate tweet deletion to the node hosting the user
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("delete_tweet", {aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    tweetid: tweetId, userid: userId}, []
                )
            } catch(e) {
                lapi.Error("Tweed delete_tweet: Failed to call delete_tweet on remote node %s: %s, userId=%s, tweetId=%s", user.hostIds[0], e, userId, tweetId)
                throw e
            }
            lapi.Debug("Tweed delete_tweet: remote ret=%s", JSON.stringify(ret))
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // Get tweet content to determine ownership and handle attachments
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
            lapi.Debug("Tweed delete_tweet: tweet=%s", JSON.stringify(tweet))

            // Only tweet authors can permanently delete tweets
            // Other users can only remove tweets from their personal lists
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            if (tweet && tweet.authorId == userId) {
                // ============================================================
                // TWEET AUTHOR DELETION (PERMANENT)
                // ============================================================
                
                // Remove references to tweet attachments
                // Unreferenced attachments will be deleted by garbage collector
                tweet.attachments?.forEach(element => {
                    lapi.MMDelRef(tweetSid, tweetId, element.mid)
                });
                
                // Permanently delete the tweet
                lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
                lapi.MiMeiUnpublish(tweetSid, "", tweetId)  // Remove from network
                lapi.MMDelVers(tweetSid, tweetId)  // Delete all versions

                // Remove references to original tweet if this is a retweet
                if (tweet.originalTweetId) {
                    lapi.MMDelRef(userSid, userId, tweet.originalTweetId)
                }
                
                // Remove reference from author to tweet
                lapi.MMDelRef(userSid, userId, tweetId)
            }

            // ================================================================
            // REMOVE FROM USER LISTS (ALL USERS)
            // ================================================================
            
            // Remove tweet from user's personal lists regardless of ownership
            lapi.Zrem(userSid, TWT_LIST_KEY, tweetId)  // Remove from tweet list
            lapi.Zrem(userSid, FOLLOWINGS_TWEETS, tweetId)  // Remove from following feed
            lapi.Hdel(userSid, PINNED_TWEETS, tweetId)  // Remove from pinned list
            
            // Update user data and publish changes
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)

            lapi.Debug("Tweed delete_tweet: Delete tweet %s %s", tweetId, JSON.stringify(tweet))
    
            // Update the user's score in application data
            try {
                lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
                    userid: userId, mid: userId}, [])
            } catch(e) {
                lapi.Error("Tweed delete_tweet: Failed to update user score: %s, userId=%s", e, userId)
                // Don't throw - this is a cleanup operation
            }
    
            return wrapResponse({tweetid: tweetId, success: true})
        }
    } catch(e) {
        lapi.Error("Tweed Error delete_tweet: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
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
            lapi.Error("Tweed delete_tweet: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)