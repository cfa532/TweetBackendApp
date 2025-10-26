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
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Updated tweet and user data with bookmark status
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const BOOKMARK_LIST = "tweet_bookmark_list"  // Redis key for tweet's bookmark list
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user bookmarking the tweet
    const tweetId = request["tweetid"]  // ID of tweet being bookmarked
    const authorId = request["authorid"]  // ID of tweet author
    const userHostId = request["userhostid"]  // Host ID of the user

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
        
        if (!author.hostIds || author.hostIds.length === 0 || author.hostIds[0] !== nodeId) {
            // Delegate bookmark management to the node hosting the author
            let ret = lapi.RunMApp("toggle_bookmark", {aid: APP_ID, ver: "last", 
                nid: author.hostIds[0], sid: systemSid, userhostid: userHostId,
                userid: userId, authorid: authorId, tweetid: tweetId}, []
            )
            
            // Now sync the tweet from the remote host
            try {
                // Note: Content existence check could be implemented here
                // if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                    lapi.MiMeiProvide(systemSid, "", tweetId)
                // }
            } catch(e) {
                lapi.Error("toggle_bookmark Error provide tweet", e, JSON.stringify(ret))
            }
            
            lapi.Debug("toggle_bookmark remote ret=", JSON.stringify(ret))
            return ret
        } else {
            // ====================================================================
            // LOCAL AUTHOR HANDLING
            // ====================================================================
            // ================================================================
            // LOCAL BOOKMARK MANAGEMENT
            // ================================================================
            
            // Toggle bookmark status in the tweet's bookmark list
            const updatedTweet = toggleBookmarkOfTweet(userId, authorId, tweetId)
            
            // Toggle the bookmark of the tweet in appUser's node
            const updatedUser = lapi.RunMApp("toggle_bookmark_by_user", {aid: APP_ID, ver: "last",
                nid: userHostId, sid: systemSid,
                userid: userId, tweetid: tweetId, isbookmarked: updatedTweet.favorites[1]}, []
            )
            
            lapi.Debug("toggle_bookmark local tweet", JSON.stringify(updatedTweet), JSON.stringify(updatedUser))
            return {success: true, user: updatedUser, tweet: updatedTweet}
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("toggle_bookmark error", e, JSON.stringify(request))
        return {success: false, error: e}
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
    function toggleBookmarkOfTweet(
        appUserId,     // AppUser who bookmarks the tweet 
        authorId,      // Author of the tweet
        tweetId,       // ID of tweet being bookmarked
    ) {
        // Update bookmark list of a tweet
        try {
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")  // Open tweet for editing
            
            // Check if user has already bookmarked this tweet
            const hasMarked = lapi.Hget(tweetSid, BOOKMARK_LIST, appUserId) ? true : false
            
            if (hasMarked) {
                // Remove bookmark if already bookmarked
                lapi.Hdel(tweetSid, BOOKMARK_LIST, appUserId)
            } else {
                // Add bookmark with timestamp
                lapi.Hset(tweetSid, BOOKMARK_LIST, appUserId, Date.now())
            }
            
            // Update tweet data and publish changes
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(tweetSid, "", tweetId)
    
            // Update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: authorId, mid: tweetId}, []
            )
            
            // Return updated tweet
            return lapi.RunMApp("get_tweet", {aid: APP_ID, ver: "last",
                tweetid: tweetId, appuserid: appUserId}, []
            )
        } catch(e) {
            lapi.Error("Error toggleBookmarkOfTweet", JSON.stringify(request), e)
            return null
        }    
    }

    /**
     * Retrieves user data from the system
     * @param {string} mid - User ID to retrieve data for
     * @returns {Object|null} User data object or null if not found
     */
    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
        const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
        return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
    }
})(request, args)