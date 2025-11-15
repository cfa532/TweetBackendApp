/**
 * Delete Comment Function
 * 
 * This function deletes a comment from a tweet in a distributed social media system.
 * Both the comment author and the original tweet author can delete comments.
 * 
 * Key Features:
 * - Handles both local and remote comment deletion
 * - Removes comment from tweet's comment list
 * - Deletes comment references and updates counts
 * - Updates tweet scores and publishes changes
 * 
 * Flow:
 * 1. Determines if target tweet is on local or remote node
 * 2. For remote tweets: delegates to appropriate node and syncs content
 * 3. For local tweets: deletes comment and updates references
 * 4. Updates parent tweet's comment count and score
 * 
 * @param {Object} request - The request object containing deletion data
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user requesting deletion
 * @param {string} request.tweetid - ID of tweet containing the comment
 * @param {string} request.commentid - ID of comment to delete
 * @param {string} request.hostid - Node ID where the tweet is hosted
 * @param {Array} args - Additional arguments (unused)
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
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
    
    try {
        const COMMENT_LIST = "comment_list_key"  // Redis key for tweet's comment list
        const APP_ID = request["aid"]  // Application identifier
        const appUserId = request["appuserid"]  // ID of user requesting deletion
        const tweetId = request["tweetid"]  // ID of tweet containing the comment
        const commentId = request["commentid"]  // ID of comment to delete
        const hostId = request["hostid"]  // Node ID where the tweet is hosted
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        let nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        
        // ========================================================================
        // REMOTE TWEET HANDLING
        // ========================================================================
        
        if (nodeId !== hostId) {
            // Delegate comment deletion to the node hosting the tweet
            let ret = lapi.RunMApp("delete_comment", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                appuserid: appUserId, tweetid: tweetId, commentid: commentId},
                [])
            
            // Sync the updated tweet to local node for caching
            try {
                lapi.MiMeiSync(systemSid, "", tweetId, {})
                lapi.MiMeiProvide(systemSid, "", tweetId)
            } catch(e) {
                lapi.Error("Tweed delete_comment: Error sync tweet: %s, ret=%s", e, JSON.stringify(ret))
            }
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL TWEET HANDLING
            // ====================================================================
            
            // Delete the comment object
            const authSid = lapi.BELoginAsAuthor()
            try {
                const commentSid = lapi.MMOpen(authSid, commentId, "cur")
                lapi.MMDelVers(commentSid, commentId)  // Remove all versions of the comment
            } catch(e) {
                lapi.Error("Tweed delete_comment: Failed to delete comment versions %s: %s", commentId, e)
            }
    
            // Remove comment from tweet's comment list and references
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            try {
                lapi.MMDelRef(tweetSid, tweetId, commentId)  // Remove reference to comment
                lapi.Zrem(tweetSid, COMMENT_LIST, commentId)  // Remove from comment list
            } catch(e) {
                lapi.Error("Tweed delete_comment: Failed to remove comment from tweet %s: %s", tweetId, e)
            }
            
            // Backup tweet data and publish changes
            try {
                lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", tweetId)
            } catch(e) {
                lapi.Error("Tweed delete_comment: Failed to backup/publish tweet %s: %s", tweetId, e)
            }
    
            // Update the parent tweet's score in application data
            try {
                lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
                    userid: appUserId, mid: tweetId}, [])
            } catch(e) {
                lapi.Error("Tweed delete_comment: Failed to update tweet score %s: %s", tweetId, e)
            }
    
            // Return updated comment count
            let lastSid = lapi.MMOpen("", tweetId, "last")
            const commentCount = lapi.Zcard(lastSid, COMMENT_LIST)
            lapi.Debug("Tweed delete_comment: local commentCount=%s, commentId=%s", commentCount, commentId)
            return wrapResponse({success: true, commentId: commentId, count: commentCount})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error delete_comment: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
})(request, args)