/**
 * Toggle Favorite Function
 * 
 * This function manages the favorite status of a tweet by a user. It handles both
 * the tweet's favorite list and the user's favorite list to ensure synchronization
 * across the distributed system.
 * 
 * Key Features:
 * - Toggles favorite status in tweet's favorite list
 * - Updates user's favorite list via remote call
 * - Handles both local and remote favorite management
 * - Syncs content when favorited
 * - Maintains data consistency across nodes
 * 
 * @param {Object} request - The request object containing favorite data
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user favoriting the tweet
 * @param {string} request.tweetid - ID of tweet being favorited
 * @param {string} request.authorid - ID of tweet author
 * @param {string} request.userhostid - Host ID of the user
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Updated tweet and user data with favorite status
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const FAVORITE_LIST = "tweet_like_list"  // Redis key for tweet's favorite list
    const APP_ID = request["aid"]  // Application identifier
    const appUserId = request["appuserid"]  // ID of user favoriting the tweet
    const tweetId = request["tweetid"]  // ID of tweet being favorited
    const authorId = request["authorid"]  // ID of tweet author
    const userHostId = request["userhostid"]  // Host ID of the user
    
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
            return {success: false, message: error.message || String(error), error: String(error)}
        }
        return {success: false, error: String(error)}
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)  // Open application data node
        const author = getUser(authorId)  // Get tweet's author data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    
        // ========================================================================
        // REMOTE AUTHOR HANDLING
        // ========================================================================
        
        if (!author || !author.hostIds || author.hostIds.length === 0) {
            lapi.Error("Tweed toggle_favorite: missing host for author %s", JSON.stringify({authorId, nodeId, author}))
            throw new Error("Author host not found")
        }

        if (author.hostIds[0] !== nodeId) {
            // Current node is not the author's host, where tweet is published
            // Send the request to that remote host that published the tweet
            let ret
            try {
                ret = lapi.RunMApp("toggle_favorite", {aid: APP_ID, ver: "last",
                    nid: author.hostIds[0], sid: systemSid, userhostid: userHostId,
                    version: version,
                    appuserid: appUserId, authorid: authorId, tweetid: tweetId}, []
                )
            } catch(e) {
                lapi.Error("Tweed toggle_favorite: Failed to call toggle_favorite on remote node %s: %s, appUserId=%s, tweetId=%s", author.hostIds[0], e, appUserId, tweetId)
                throw e
            }
            
            // Now sync the tweet from the remote host
            try {
                // Note: Content existence check could be implemented here
                // if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                    lapi.MiMeiProvide(systemSid, "", tweetId)
                // }
            } catch(e) {
                lapi.Error("Tweed toggle_favorite: Error sync tweet: %s, ret=%s", e, JSON.stringify(ret))
            }
            
            // Return format: {user: user, isFavorite: isFavorite, count: count}
            lapi.Debug("Tweed toggle_favorite: remote tweet=%s, appUserId=%s, tweetId=%s", JSON.stringify(ret), appUserId, tweetId)
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL AUTHOR HANDLING
            // ====================================================================
            // Current node is the author's host, where tweet is published
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")  // Open tweet for editing
            
            // ================================================================
            // FAVORITE STATUS TOGGLE
            // ================================================================
            
            // Check if user has already favorited this tweet
            const isFavorite = lapi.Hget(tweetSid, FAVORITE_LIST, appUserId) ? true : false
            
            if (isFavorite) {
                // Remove favorite if already favorited
                lapi.Hdel(tweetSid, FAVORITE_LIST, appUserId)
            } else {
                // Add favorite with timestamp
                lapi.Hset(tweetSid, FAVORITE_LIST, appUserId, Date.now())
            }
            
            // Update tweet data and publish changes
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(tweetSid, "", tweetId)
    
            // Update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: authorId, mid: tweetId}, []
            )
            
            // ================================================================
            // USER FAVORITE LIST UPDATE
            // ================================================================
            
            // Return updated tweet
            const updatedTweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver: "last",
                tweetid: tweetId, appuserid: appUserId}, []
            )
    
            // Toggle the favorite status of the tweet in appUser's node
            let updatedUser
            try {
                updatedUser = lapi.RunMApp("toggle_favorite_by_user", {aid: APP_ID, ver: "last",
                    nid: userHostId, sid: systemSid,
                    userid: appUserId, tweetid: tweetId, isfavorite: updatedTweet.favorites[0]}, []
                )
            } catch(e) {
                lapi.Error("Tweed toggle_favorite: Failed to call toggle_favorite_by_user: %s, appUserId=%s, tweetId=%s", e, appUserId, tweetId)
                throw e
            }
            
            lapi.Debug("Tweed toggle_favorite: local tweet=%s, user=%s", JSON.stringify(updatedTweet), JSON.stringify(updatedUser))
            return wrapResponse({success: true, user: updatedUser, tweet: updatedTweet })
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error toggle_favorite: %s, request=%s", e, JSON.stringify(request))
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
            lapi.Error("Tweed toggle_favorite: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)