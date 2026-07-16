/**
 * Toggle Bookmark Function
 * 
 * This function manages the bookmark status of a tweet by a user. It handles both
 * the tweet's bookmark list and the user's bookmark list to ensure synchronization
 * across the distributed system.
 * 
 * Key Features:
 * - Toggles bookmark status in tweet's bookmark list
 * - Updates user's bookmark list via remote call
 * - Handles both local and remote bookmark management
 * - Syncs content when bookmarked
 * - Maintains data consistency across nodes
 * 
 * @param {Object} request - The request object containing bookmark data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user bookmarking the tweet
 * @param {string} request.tweetid - ID of tweet being bookmarked
 * @param {string} request.authorid - ID of tweet author
 * @param {string} request.userhostid - Host ID of the user
 * @param {boolean|string} [request.isbookmarked] - Desired state; omitted for legacy toggle behavior
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Updated tweet and user data with bookmark status
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const BOOKMARK_LIST = "tweet_bookmark_list"  // Redis key for tweet's bookmark list
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user bookmarking the tweet
    const tweetId = request["tweetid"]  // ID of tweet being bookmarked
    const authorId = request["authorid"]  // ID of tweet author
    const userHostId = request["userhostid"]  // Host ID of the user
    const hasRequestedBookmarkState = Object.prototype.hasOwnProperty.call(request, "isbookmarked")
        && request["isbookmarked"] !== null && request["isbookmarked"] !== undefined
    const requestedBookmarkState = request["isbookmarked"] === true || request["isbookmarked"] === "true"
    
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
        const author = getUser(authorId)  // Get author data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier

        // ========================================================================
        // REMOTE AUTHOR HANDLING
        // ========================================================================
        
        if (!author || !author.hostIds || author.hostIds.length === 0) {
            lapi.Error("Tweed toggle_bookmark: missing host for author %s", JSON.stringify({authorId, nodeId, author}))
            throw new Error("Author host not found")
        }

        if (author.hostIds[0] !== nodeId) {
            // Delegate bookmark management to the node hosting the author
            let ret
            try {
                const remoteRequest = {aid: APP_ID, ver: "last",
                    nid: author.hostIds[0], sid: systemSid, userhostid: userHostId,
                    version: version,
                    userid: userId, authorid: authorId, tweetid: tweetId}
                if (hasRequestedBookmarkState) remoteRequest.isbookmarked = requestedBookmarkState
                ret = lapi.RunMApp("toggle_bookmark", remoteRequest, [])
            } catch(e) {
                lapi.Error("Tweed toggle_bookmark: Failed to call toggle_bookmark on remote node %s: %s, userId=%s, tweetId=%s", author.hostIds[0], e, userId, tweetId)
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
                lapi.Error("Tweed toggle_bookmark: Error provide tweet: %s, ret=%s", e, JSON.stringify(ret))
            }
            
            lapi.Debug("Tweed toggle_bookmark: remote ret=%s", JSON.stringify(ret))
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL AUTHOR HANDLING
            // ====================================================================
            // ================================================================
            // LOCAL BOOKMARK MANAGEMENT
            // ================================================================
            
            // Toggle bookmark status in the tweet's bookmark list
            const updatedTweet = updateBookmarkOfTweet(
                userId,
                authorId,
                tweetId,
                hasRequestedBookmarkState ? requestedBookmarkState : null
            )
            
            // Toggle the bookmark of the tweet in appUser's node
            let updatedUser
            try {
                updatedUser = lapi.RunMApp("toggle_bookmark_by_user", {aid: APP_ID, ver: "last",
                    nid: userHostId, sid: systemSid,
                    userid: userId, tweetid: tweetId, isbookmarked: updatedTweet.favorites[1],
                    skipcontentsync: userHostId === nodeId}, []
                )
            } catch(e) {
                lapi.Error("Tweed toggle_bookmark: Failed to call toggle_bookmark_by_user: %s, userId=%s, tweetId=%s", e, userId, tweetId)
                throw e
            }
            
            lapi.Debug("Tweed toggle_bookmark: local tweet=%s, user=%s", JSON.stringify(updatedTweet), JSON.stringify(updatedUser))
            return wrapResponse({success: true, user: updatedUser, tweet: updatedTweet})
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error toggle_bookmark: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Toggles bookmark status in the tweet's bookmark list
     * @param {string} appUserId - ID of user bookmarking the tweet
     * @param {string} authorId - ID of tweet author
     * @param {string} tweetId - ID of tweet being bookmarked
     * @returns {Object|null} Updated tweet object or null if error
     */
    function updateBookmarkOfTweet(
        appUserId,     // AppUser who bookmarks the tweet 
        authorId,      // Author of the tweet
        tweetId,       // ID of tweet being bookmarked
        requestedState // null for legacy toggle behavior
    ) {
        // Update bookmark list of a tweet
        try {
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")  // Open tweet for editing
            
            // Check if user has already bookmarked this tweet
            const wasBookmarked = lapi.Hget(tweetSid, BOOKMARK_LIST, appUserId) ? true : false
            const isBookmarked = requestedState === null ? !wasBookmarked : requestedState
            const bookmarkChanged = isBookmarked !== wasBookmarked
            
            if (bookmarkChanged) {
                if (isBookmarked) {
                    lapi.Hset(tweetSid, BOOKMARK_LIST, appUserId, Date.now())
                } else {
                    lapi.Hdel(tweetSid, BOOKMARK_LIST, appUserId)
                }

                // Update tweet data and publish changes
                lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
                lapi.MiMeiPublish(tweetSid, "", tweetId)

                // Update the score of the user in AppData
                lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                    userid: authorId, mid: tweetId}, []
                )
            }
            
            // Return updated tweet
            const tweetResp = lapi.RunMApp("get_tweet", {aid: APP_ID, ver: "last",
                version: 'v2', tweetid: tweetId, appuserid: appUserId}, []
            )
            return tweetResp?.success ? tweetResp.data : null
        } catch(e) {
            lapi.Error("Tweed toggle_bookmark: Error toggleBookmarkOfTweet: %s, request=%s", e, JSON.stringify(request))
            return null
        }    
    }

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
            lapi.Error("Tweed toggle_bookmark: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)
