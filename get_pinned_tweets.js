/**
 * Get Pinned Tweets Function
 * 
 * This function retrieves the list of pinned tweets for a specific user.
 * Pinned tweets are displayed at the top of a user's profile and are
 * returned with their pinning timestamp.
 * 
 * Key Features:
 * - Retrieves pinned tweets with pinning timestamps
 * - Returns complete tweet objects with metadata
 * - Filters out invalid or missing tweets
 * - Handles error cases gracefully
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user requesting pinned tweets
 * @param {string} request.userid - ID of user whose pinned tweets to retrieve
 * @param {Array} args - Additional arguments (unused)
 * @returns {Array} Array of objects containing tweet and pinning timestamp
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    try {
        const PINNED_TWEETS = "pinned_tweet_list"  // Redis key for user's pinned tweets
        const appUserId = request["appuserid"]  // ID of user requesting pinned tweets
        const userId = request["userid"]  // ID of user whose pinned tweets to retrieve
        const mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space

        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Get pinned tweet IDs and convert to full tweet objects with timestamps
        return lapi.Hkeys(mmsid, PINNED_TWEETS).map(tweetId => {
            let ts = lapi.Hget(mmsid, PINNED_TWEETS, tweetId).toString()  // Pinning timestamp
            let tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: tweetId}, [])
            if (tweet) {
                // Note: timestamp is when the tweet was pinned, not its creation time
                return {tweet: tweet, timestamp: ts}
            }
        }).filter(e=> e);  // Remove null/undefined results
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error get_pinned_tweets:", e, JSON.stringify(request))
        return []
    }
})(request, args)