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
    
    // Needed to find out if appUser has liked or bookmarked the tweet
    const appUserId = request["appuserid"]  // ID of user requesting the tweet (for interaction checks)
    const tweetId = request["tweetid"]  // ID of tweet to refresh
    const hostId = request["hostid"]  // Main host ID of the tweet's author
    const authorId = request["userid"]  // Author ID of the tweet

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // TWEET SYNCHRONIZATION
        // ========================================================================
        
        if (nodeId !== hostId) {
            lapi.Debug("refresh_tweet", tweetId, "on", nodeId, "from host", hostId)
            
            // Make sure the current node is up to date by syncing from author's host
            lapi.RunMApp("node_update_mid_by_score", {aid: request["aid"], ver:"last",
                hostid: hostId, userid: authorId, mid: tweetId}, [])
        }
        
        // ========================================================================
        // FRESH TWEET RETRIEVAL
        // ========================================================================
        
        // Get the fresh tweet data with user interaction status
        return lapi.RunMApp("get_tweet", {aid: request.aid, ver:"last",
            appuserid: appUserId, tweetid: tweetId}, [])
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Error refresh_tweet", e, JSON.stringify(request))
    }
})(request, args)