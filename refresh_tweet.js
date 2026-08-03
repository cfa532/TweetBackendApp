/**
 * Refresh Tweet Function
 * 
 * This function ensures the current node has the most up-to-date version of a tweet
 * by syncing it from the author's host before retrieving it. Unlike get_tweet, this
 * function guarantees fresh data by performing synchronization operations.
 * 
 * Key Features:
 * - Syncs tweet from author's host to ensure current data
 * - Updates tweet content and comments to latest versions
 * - Checks user interaction status (bookmarked, favored)
 * - Handles both local and remote tweet synchronization
 * - Returns fresh tweet data with user interaction flags
 * 
 * @param {Object} request - The request object containing tweet data
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user requesting the tweet (for interaction checks)
 * @param {string} request.tweetid - ID of tweet to refresh
 * @param {string} request.hostid - Main host ID of the tweet's author
 * @param {string} request.userid - Author ID of the tweet
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object|null} Fresh tweet object with interaction data, or null if error
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
    // Needed to find out if appUser has liked or bookmarked the tweet
    const appUserId = request["appuserid"]  // ID of user requesting the tweet (for interaction checks)
    const tweetId = request["tweetid"]  // ID of tweet to refresh
    const hostId = request["hostid"]  // Main host ID of the tweet's author
    const authorId = request["userid"]  // Author ID of the tweet
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === null || result === undefined) {
                return {success: false, message: "Tweet not found"}
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
        return null
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // TWEET SYNCHRONIZATION
        // ========================================================================
        
        if (nodeId !== hostId) {
            lapi.Debug("Tweed refresh_tweet: tweetId=%s on nodeId=%s from hostId=%s", tweetId, nodeId, hostId)
            
            // Make sure the current node is up to date by syncing from author's host
            try {
                lapi.RunMApp("node_update_mid_by_score", {aid: request["aid"], ver:"last",
                    hostid: hostId, userid: authorId, mid: tweetId}, [])
            } catch(e) {
                lapi.Error("Tweed refresh_tweet: Failed to update mid by score for tweetId=%s: %s", tweetId, e)
            }
        }
        
        // ========================================================================
        // FRESH TWEET RETRIEVAL
        // ========================================================================
        
        // Get the fresh tweet data with user interaction status
        const tweetResp = lapi.RunMApp("get_tweet", {aid: request.aid, ver:"last",
            version: 'v2', appuserid: appUserId, tweetid: tweetId}, [])
        const tweet = tweetResp?.success ? tweetResp.data : null
        return wrapResponse(tweet)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error refresh_tweet: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)