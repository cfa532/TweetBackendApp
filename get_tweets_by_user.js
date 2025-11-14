/**
 * Get Tweets By User Function
 * 
 * This function retrieves a paginated list of tweets from a specific user.
 * It includes privacy filtering and handles retweets with original tweet collection.
 * 
 * Key Features:
 * - Paginated tweet retrieval for a specific user
 * - Privacy filtering (hides private tweets from non-authors)
 * - Handles retweets with original tweet collection
 * - Reverse chronological ordering (newest first)
 * - Returns both tweets and original tweets for retweets
 * 
 * @param {Object} request - The request object containing query parameters
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user whose tweets to retrieve
 * @param {string} request.appuserid - ID of user requesting the tweets
 * @param {number} request.pn - Page number (0-based)
 * @param {number} request.ps - Page size (number of tweets per page)
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Object containing tweets, original tweets, and success status
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"  // Redis key for user's tweet list
        const pageNum = parseInt(request["pn"], 10)  // Page number (0-based)
        const pageSize = parseInt(request["ps"], 10)  // Number of tweets per page
        const startRank = pageNum * pageSize  // Starting index for pagination
        const endRank = startRank + pageSize - 1  // Ending index for pagination
        const userId = request["userid"]  // ID of user whose tweets to retrieve
        const appUserId = request["appuserid"]  // ID of user requesting the tweets
        const mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space

        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Get tweets in reverse chronological order (newest first)
        const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, startRank, endRank)
        
        // Convert tweet IDs to full tweet objects with privacy filtering
        let tweets = arr.map(sp => {
            const tweetId = sp.Member
            const tweet = lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
                appuserid: appUserId, tweetid: tweetId}, [])
            
            // Hide private tweets from non-authors
            if (tweet && tweet.isPrivate === true && appUserId !== tweet.authorId) {
                return null
            }
            return tweet
        })
        
        // Collect original tweets for retweets (tweets with originalTweetId)
        let originalTweets = []
        tweets.forEach(tweet => {
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
        
        return {
            success: true,
            tweets: tweets,
            originalTweets: originalTweets,
            tidList: arr.map(sp => sp.Member)
        }
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_tweets_by_user: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return {
            success: false,
            error: e.message
        }
    }
})(request, args)