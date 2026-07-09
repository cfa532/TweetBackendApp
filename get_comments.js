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
        const pageNumber = parseInt(request['pn'], 10);;  // Page number (0-based)
        const pageSize = parseInt(request['ps'], 10);;  // Number of comments per page
        const startRank = pageNumber * pageSize;  // Starting index for pagination (inclusive)
        const endRank = startRank + pageSize - 1;  // Zrevrange stop is inclusive
        const tweetId = request["tweetid"]  // ID of tweet to get comments for
        const mmsid = lapi.MMOpen("", tweetId, "last")  // Open tweet's memory space
        const TWT_CONTENT_KEY = "core_data_of_tweet"  // Key for tweet content storage
        const parentTweet = lapi.Get(mmsid, TWT_CONTENT_KEY)

        // Comments live in the same mimei as their parent tweet, so only trust a
        // missing comment as "truly gone" (rather than just unsynced to this
        // replica) when this node is confirmed to be the tweet author's home node.
        // Failure here must not break the comments response itself (backward
        // compat with callers that predate this cleanup), so it's isolated in
        // its own try/catch and simply falls back to skipping cleanup.
        let isHomeNode = false
        if (!parentTweet?.authorId) {
            lapi.Debug("Tweed get_comments: no parentTweet/authorId for tweetId=%s, skipping stale-comment cleanup", tweetId)
        } else {
            try {
                const author = lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver: "last",
                    userid: parentTweet.authorId}, [])
                isHomeNode = !!(author?.hostIds?.[0] && author.hostIds[0] === author.hostIds[1])
                lapi.Debug("Tweed get_comments: tweetId=%s authorId=%s hostIds=%s isHomeNode=%s",
                    tweetId, parentTweet.authorId, JSON.stringify(author?.hostIds), String(isHomeNode))
            } catch (e) {
                lapi.Error("Tweed get_comments: get_user_core_data failed for authorId=%s: %s", parentTweet.authorId, e)
            }
        }

        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================

        // Get comment IDs in reverse chronological order (newest first)
        const arr = lapi.Zrevrange(mmsid, COMMENT_LIST, startRank, endRank)

        // Convert comment IDs to full comment objects (tweets).
        // If get_tweet returns null and we're not on the home node, the comment
        // may simply not be synced here yet — return a minimal stub {mid} so the
        // client knows the ID. On the home node, a null result means the comment
        // is genuinely gone, so drop it from the list instead.
        const staleCommentIds = []
        const comments = arr.map(sp => {
            const commentId = sp.Member
            const commentResp = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                version: 'v2', appuserid: appUserId, tweetid: commentId}, [])
            const comment = commentResp?.success ? commentResp.data : null
            if (comment) return comment
            if (isHomeNode) {
                staleCommentIds.push(commentId)
                return null
            }
            lapi.Debug("Tweed get_comments: commentId=%s unresolved on tweetId=%s but this is not the home node; keeping stub", commentId, tweetId)
            return {mid: commentId}
        }).filter(c => c !== null)

        // Best-effort: a failure anywhere in this cleanup must not break the
        // comments response, since the comment list was already built above.
        if (isHomeNode && staleCommentIds.length > 0) {
            try {
                const authSid = lapi.BELoginAsAuthor()
                const writeSid = lapi.MMOpen(authSid, tweetId, "cur")
                staleCommentIds.forEach(commentId => {
                    lapi.Debug("Tweed get_comments: removing stale commentId=%s from tweetId=%s", commentId, tweetId)
                    lapi.Zrem(writeSid, COMMENT_LIST, commentId)
                })
                lapi.MMBackup(writeSid, tweetId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", tweetId)
            } catch (e) {
                lapi.Error("Tweed get_comments: failed to remove stale commentIds for tweetId=%s: %s", tweetId, e)
            }
        }

        return wrapResponse(comments)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_comments: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)