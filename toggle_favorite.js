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
    
    const FAVORITE_LIST = "tweet_like_list"  // Redis key for tweet's favorite list
    const APP_ID = request["aid"]  // Application identifier
    const appUserId = request["appuserid"]  // ID of user favoriting the tweet
    const tweetId = request["tweetid"]  // ID of tweet being favorited
    const authorId = request["authorid"]  // ID of tweet author
    const userHostId = request["userhostid"]  // Host ID of the user

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
        
        if (!author.hostIds || author.hostIds.length === 0 || author.hostIds[0] !== nodeId) {
            // Current node is not the author's host, where tweet is published
            // Send the request to that remote host that published the tweet
            let ret = lapi.RunMApp("toggle_favorite", {aid: APP_ID, ver: "last",
                nid: author.hostIds[0], sid: systemSid, userhostid: userHostId,
                appuserid: appUserId, authorid: authorId, tweetid: tweetId}, []
            )
            
            // Now sync the tweet from the remote host
            try {
                // Note: Content existence check could be implemented here
                // if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                    lapi.MiMeiProvide(systemSid, "", tweetId)
                // }
            } catch(e) {
                console.error("toggle_favorite Error sync tweet", e, JSON.stringify(ret))
            }
            
            // Return format: {user: user, isFavorite: isFavorite, count: count}
            console.log("toggle_favorite remote tweet", JSON.stringify(ret), appUserId, tweetId)
            return ret
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
            const updatedUser = lapi.RunMApp("toggle_favorite_by_user", {aid: APP_ID, ver: "last",
                nid: userHostId, sid: systemSid,
                userid: appUserId, tweetid: tweetId, isfavorite: updatedTweet.favorites[0]}, []
            )
            
            console.log("toggle_favorite local tweet", JSON.stringify(updatedTweet), JSON.stringify(updatedUser))
            return {success: true, user: updatedUser, tweet: updatedTweet }
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error toggle_favorite", e, JSON.stringify(request))
        return {success: false, error: e}
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
        const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
        const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
        return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
    }
})(request, args)