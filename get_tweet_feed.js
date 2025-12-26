/**
 * Get Tweet Feed Function
 * 
 * This function retrieves a paginated feed of tweets from users that the
 * requesting user is following. It includes both regular tweets and retweets,
 * with privacy filtering and original tweet collection for retweets.
 * 
 * Key Features:
 * - Paginated tweet feed from following users
 * - Privacy filtering (removes private tweets)
 * - Handles retweets with original tweet collection
 * - Reverse chronological ordering (newest first)
 * - Returns both tweets and original tweets for retweets
 * 
 * @param {Object} request - The request object containing feed parameters
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user whose feed to retrieve
 * @param {string} request.appuserid - ID of user requesting the feed
 * @param {number} request.pn - Page number (0-based)
 * @param {number} request.ps - Page size (number of tweets per page)
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Object containing tweets, original tweets, and success status
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
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error}
        }
        return {success: false, error: error.message}
    }
    
    try {
        const FOLLOWINGS_TWEETS = "followings_tweets"  // Redis key for following tweets feed
        const pageNum = parseInt(request["pn"], 10)  // Page number (0-based)
        const pageSize = parseInt(request["ps"], 10)  // Number of tweets per page
        const startRank = pageNum * pageSize  // Starting index for pagination
        const endRank = startRank + pageSize - 1  // Ending index for pagination
        const userId = request["userid"]  // ID of user whose feed to retrieve
        const appUserId = request["appuserid"]  // ID of user requesting the feed
        const mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space
    
        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Get tweets from following users in reverse chronological order
        const arr = lapi.Zrevrange(mmsid, FOLLOWINGS_TWEETS, startRank, endRank)
        .map(sp => {
            const tweetId = sp.Member
            if (tweetId === null) {
                return null
            }
            const tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: tweetId}, [])
            
            // Filter out private tweets (replace with null)
            if (tweet && tweet.isPrivate === true) {
                return null
            }
            return tweet
        })
        
        // Collect original tweets for retweets (tweets with originalTweetId)
        let originalTweets = []
        arr.forEach(tweet => {
            if (tweet && tweet.originalTweetId) {
                const originalTweet = lapi.RunMApp("get_tweet", {
                    aid: request["aid"], 
                    ver: "last",
                    appuserid: appUserId, 
                    tweetid: tweet.originalTweetId
                }, [])
                if (originalTweet) {
                    originalTweets.push(originalTweet)
                }
            }
        })
        
        // Return all tweets including nulls to enable client-side end-of-feed detection
        return wrapResponse({
            success: true,
            tweets: arr,
            originalTweets: originalTweets
        })
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_tweet_feed: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)