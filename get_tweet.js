/**
 * Get Tweet Function
 * 
 * This function retrieves a complete tweet object with user interaction data.
 * It gets the tweet from the author's node (which may not be the most current)
 * but provides better user experience. For the latest data, use refresh_tweet.
 * 
 * Key Features:
 * - Retrieves complete tweet data with interaction counts
 * - Checks user's interaction status (liked, bookmarked, retweeted)
 * - Returns engagement metrics (likes, bookmarks, comments, retweets)
 * - Handles private tweets appropriately
 * - Provides user-specific interaction flags
 * 
 * @param {Object} request - The request object containing tweet data
 * @param {string} request.tweetid - ID of tweet to retrieve
 * @param {string} request.appuserid - ID of user requesting the tweet (for interaction checks)
 * @param {boolean} [request.fromdetailview] - When true, sync from the author's write
 *   node (hostIds[0]) if it differs from this node (hostIds[1]) before responding
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object|null} Complete tweet object with interaction data, or null if not found
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
    // Note: appuserid is NOT the tweet author, but the current app user
    // It's used to check if the current user has liked, bookmarked, or retweeted this tweet
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === null || result === undefined) {
                return {success: false, message: "Tweet not found"}
            }
            // If result already has success field (e.g. delegated RunMApp call),
            // return as-is to avoid double-wrapping.
            if (typeof result === 'object' && 'success' in result) {
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
        return null
    }
    
    try {
        const TWT_CONTENT_KEY = "core_data_of_tweet"  // Key for tweet content storage
        const FAVORITE_LIST = "tweet_like_list"  // Redis key for tweet likes
        const BOOKMARK_LIST = "tweet_bookmark_list"  // Redis key for tweet bookmarks
        const RETWEET_LIST = "tweet_retweet_list"  // Redis key for tweet retweets
        const COMMENT_LIST = "comment_list_key"  // Redis key for tweet comments

        const appUserId = request["appuserid"]  // ID of user requesting the tweet
        const tweetId = request["tweetid"]  // ID of tweet to retrieve
        let mmsid = lapi.MMOpen("", tweetId, "last")  // Open tweet's memory space
        let tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)  // Get tweet content

        if (!tweet)
            return wrapResponse(null)

        // When called from the tweet detail view, this node may not be the
        // author's write node (hostIds[0]) — unlike refresh_tweet, get_tweet
        // does not otherwise sync before reading. Pull the latest data across
        // now so the detail view doesn't show stale content/counts.
        if (request.fromdetailview && tweet.authorId) {
            try {
                const author = lapi.RunMApp("get_user_core_data", {
                    aid: request["aid"],
                    ver: "last",
                    userid: tweet.authorId,
                }, [])
                const writeHostId = author?.hostIds?.[0]
                const readHostId = author?.hostIds?.[1]
                if (writeHostId && readHostId && writeHostId !== readHostId) {
                    lapi.RunMApp("node_update_mid_by_score", {
                        aid: request["aid"],
                        ver: "last",
                        hostid: writeHostId,
                        userid: tweet.authorId,
                        mid: tweetId,
                    }, [])
                    mmsid = lapi.MMOpen("", tweetId, "last")
                    tweet = lapi.Get(mmsid, TWT_CONTENT_KEY) ?? tweet
                }
            } catch (e) {
                lapi.Error("Tweed get_tweet: fromdetailview sync failed for %s: %s", tweetId, e)
            }
        }

        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Check if the current user has interacted with this tweet
        const isFavorite = lapi.Hget(mmsid, FAVORITE_LIST, appUserId)
        const isBookmarked = lapi.Hget(mmsid, BOOKMARK_LIST, appUserId)
        const hasRetweeted = lapi.Hget(mmsid, RETWEET_LIST, appUserId)
        
        // Build complete tweet response object
        let ret = {
            // Core tweet data
            "mid": tweet.mid,
            "authorId": tweet.authorId,
            "title": tweet.title,
            "attachments": tweet.attachments?.map(a => {
                return a
            }),
            "isPrivate": tweet.isPrivate,  // Viewable by author only
            "downloadable": tweet.downloadable,  // If the attachment is downloadable
            "originalTweetId": tweet.originalTweetId,
            "originalAuthorId": tweet.originalAuthorId,
            "timestamp": tweet.timestamp,
            "contentType": tweet.contentType,
            
            // Engagement metrics
            "bookmarkCount": lapi.Hlen(mmsid, BOOKMARK_LIST),
            "favoriteCount": lapi.Hlen(mmsid, FAVORITE_LIST),
            "commentCount": lapi.Zcard(mmsid, COMMENT_LIST),
            "retweetCount": lapi.Hlen(mmsid, RETWEET_LIST),
            
            // User interaction flags [isFavorite, isBookmarked, hasRetweeted]
            "favorites": [
                isFavorite ? true : false,
                isBookmarked ? true : false,
                hasRetweeted ? true : false,
            ],
        }
        
        // Add content if present (prevent null from becoming empty string)
        if (tweet.content)
            ret["content"] = tweet.content

        // For v3, return array with current tweet and original tweet if it exists and is not null
        if (version === 'v3') {
            const resultArray = [ret]
            if (tweet.originalTweetId) {
                const originalTweet = lapi.RunMApp("get_tweet", {
                    aid: request["aid"],
                    ver: "last",
                    tweetid: tweet.originalTweetId,
                    appuserid: appUserId,
                    version: version,
                    fromdetailview: request.fromdetailview
                }, [])
                if (originalTweet) {
                    resultArray.push(originalTweet)
                }
            }
            return wrapResponse(resultArray)
        }

        return wrapResponse(ret)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_tweet: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)
