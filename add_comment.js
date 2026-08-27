/**
 * Add Comment Function
 * 
 * This function adds a comment to an existing tweet in a distributed social media system.
 * Comments are treated as tweet objects themselves, allowing for nested conversations.
 * 
 * Key Features:
 * - Handles both local and remote tweet commenting
 * - Supports quoted tweets (retweets with comments)
 * - Manages comment references and attachments
 * - Updates tweet scores and comment counts
 * 
 * Flow:
 * 1. Determines if target tweet is on local or remote node
 * 2. For remote tweets: delegates to appropriate node and syncs content
 * 3. For local tweets: creates comment object and updates references
 * 4. Handles quoted tweet creation if originalTweetId is present
 * 5. Updates parent tweet's comment count and score
 * 
 * @param {Object} request - The request object containing comment data
 * @param {string} request.aid - Application ID
 * @param {string} request.tweetauthorid - Author ID of the parent tweet/comment
 * @param {string} request.tweetid - ID of tweet being commented on
 * @param {string} request.hostid - Node ID where the original tweet is hosted
 * @param {string} request.comment - JSON string of comment object (tweet format)
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const COMMENT_LIST = "comment_list_key"  // Redis key for tweet's comment list
    const TWT_CONTENT_KEY = "core_data_of_tweet"  // Key for tweet content storage
    const APP_EXT = "com.example.twitterclone"  // Application extension identifier
    const APP_ID = request["aid"]  // Application identifier
    // Parent objects own their comments regardless of who wrote the comment.
    // `userid` is retained temporarily for older TweetWeb clients.
    const tweetAuthorId = request["tweetauthorid"] || request["userid"]
    const tweetId = request["tweetid"]  // ID of tweet being commented on
    const hostId = request["hostid"]  // Node ID where the original tweet is hosted
    const comment = JSON.parse(request['comment'])  // Parsed comment object (tweet format)
    
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
        return {success: false, message: error}
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        if (!tweetAuthorId) {
            throw new Error("Missing parent author ID: expected tweetauthorid")
        }

        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // REMOTE TWEET HANDLING
        // ========================================================================
        
        if (nodeId !== hostId) {
            // Delegate comment creation to the node hosting the original tweet
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("add_comment", {aid: APP_ID, ver: "last",
                    nid: hostId, sid: systemSid,
                    version: version,
                    hostid: hostId, tweetauthorid: tweetAuthorId, tweetid: tweetId, comment: request["comment"]}, []
                )
            } catch(e) {
                lapi.Error("Tweed add_comment: Failed to call add_comment on remote node %s: %s, tweetAuthorId=%s, tweetId=%s", hostId, e, tweetAuthorId, tweetId)
                throw e
            }
            
            // Sync the parent tweet to local node for caching; child comment mids are synced by the system.
            try {
                lapi.MiMeiSync(systemSid, "", tweetId, {})
                lapi.MiMeiProvide(systemSid, "", tweetId)
            } catch(e) {
                lapi.Error("Tweed add_comment: Error sync tweet to local node: %s", e)
            }
            
            lapi.Debug("Tweed add_comment: remote comment count=%s, nodeId=%s", JSON.stringify(ret), nodeId)
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL TWEET HANDLING
            // ====================================================================
            
            // Handle quoted tweets (comments with original tweet references)
            var retweetId = ""
            if (comment.originalTweetId && comment.originalAuthorId) {
                // Create a quoted tweet if the comment references an original tweet
                const ret = lapi.RunMApp("add_tweet", {aid: APP_ID, ver: "last",
                    hostid: hostId, tweet: request['comment']}, [])
                if (ret.success) {
                    retweetId = ret.mid
                }
                // Remove original tweet references from comment object
                delete comment.originalTweetId
                delete comment.originalAuthorId
            }

            // Create the comment object (treated as a tweet)
            const authSid = lapi.BELoginAsAuthor()
            const commentId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
            comment["mid"] = commentId  // Set the comment's unique identifier
            comment["timestamp"] = Date.now()  // Set creation timestamp
    
            // Store comment content and handle attachments
            const commentSid = lapi.MMOpen(authSid, commentId, "cur")
            lapi.Set(commentSid, TWT_CONTENT_KEY, comment)
            
            // Process any attachments (images, videos, etc.)
            comment.attachments?.forEach(element => {
                // Add reference to attachment in comment's memory space
                lapi.MMAddRef(commentSid, commentId, element.mid)
                element.timestamp = Number(element.timestamp)  // Ensure timestamp is numeric
            });
            
            // Backup comment data and publish it
            lapi.MMBackup(commentSid, commentId, "", "delref=false")
            lapi.MiMeiPublish(commentSid, "", commentId)  // Make comment available to other nodes
    
            // Add comment to the parent tweet's comment list
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            lapi.Zadd(tweetSid, COMMENT_LIST, getScorePair(commentId))  // Add with timestamp score
    
            // Create reference from tweet to comment and update tweet
            lapi.MMAddRef(tweetSid, tweetId, commentId)
            lapi.MMBackup(tweetSid, tweetId, "", "delref=false")
            lapi.MiMeiPublish(authSid, "", tweetId)  // Publish updated tweet
    
            // Update the parent tweet's score in application data
            // This ensures changes to the tweet are reflected in the app's data layer
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: tweetAuthorId, mid: tweetId}, [])
    
            // Future enhancement: Track user's comments in their profile
            // This would allow users to see all their comments in one place
            // lapi.RunMApp("add_comment_by_user", {aid: APP_ID, ver:"last",
            //      userid: userId, commentid: commentId}, [])
    
            // Return success response with comment details
            let lastSid = lapi.MMOpen("", tweetId, "last")
            const commentCount = lapi.Zcard(lastSid, COMMENT_LIST)  // Get current comment count
            lapi.Debug("Tweed add_comment: local commentCount=%s, commentId=%s, retweetId=%s", String(commentCount), commentId, retweetId)
            return wrapResponse({success: true, mid: commentId, commentId: commentId, count: commentCount, retweetid: retweetId})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error add_comment: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Creates a score pair object for Redis sorted set operations
     * @param {string} mid - The member ID to associate with the score
     * @returns {Object} ScorePair object with timestamp score and member ID
     */
    function getScorePair(mid) {
        function ScorePair() {}
        const sp = new ScorePair()
        sp.Score = Date.now()  // Use current timestamp as score for chronological ordering
        sp.Member = mid  // The ID of the comment or tweet
        return sp
    }
})(request, args)
