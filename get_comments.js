/**
 * Get Comments Function
 * 
 * This function retrieves comments for a specific tweet with pagination support.
 * Comments are returned in reverse chronological order (newest first) and
 * are fetched as complete tweet objects.
 * 
 * Key Features:
 * - Paginated comment retrieval
 * - Reverse chronological ordering (newest first)
 * - Returns complete comment objects (tweets)
 * - Efficient range-based querying
 * 
 * @param {Object} request - The request object containing query parameters
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user requesting comments
 * @param {string} request.tweetid - ID of tweet to get comments for
 * @param {number} request.pn - Page number (0-based)
 * @param {number} request.ps - Page size (number of comments per page)
 * @param {Array} args - Additional arguments (unused)
 * @returns {Array} Array of comment objects (tweets)
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
        const COMMENT_LIST = "comment_list_key"  // Redis key for tweet's comment list
        const appUserId = request["appuserid"]  // ID of user requesting comments
        const pageNumber = request['pn'];  // Page number (0-based)
        const pageSize = request['ps'];  // Number of comments per page
        const startRank = pageNumber * pageSize;  // Starting index for pagination
        const endRank = startRank + pageSize - 1;  // Ending index for pagination
        const tweetId = request["tweetid"]  // ID of tweet to get comments for
        const mmsid = lapi.MMOpen("", tweetId, "last")  // Open tweet's memory space
    
        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Get comment IDs in reverse chronological order (newest first)
        const arr = lapi.Zrevrange(mmsid, COMMENT_LIST, startRank, endRank)
        
        // Convert comment IDs to full comment objects (tweets)
        const comments = arr.map(sp => {
            return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: sp.Member}, [])
        })
        // Note: Filter could be added here to remove null/undefined results
        // .filter(e=> e)
        return wrapResponse(comments)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_comments: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
})(request, args)