/**
 * Get Tweet Feed Function
 *
 * This function retrieves a paginated feed of tweets, including from users that the
 * requesting user is following. It includes both regular tweets and retweets,
 * with privacy filtering and original tweet collection for retweets.
 *
 * Key Features:
 * - Paginated tweet feed from following users
 * - Privacy filtering (removes private tweets)
 * - Handles retweets with original tweet collection
 * - Reverse chronological ordering (newest first)
 * - Returns both tweets and original tweets for retweets
 * - Cleans up stale tweet IDs from all user lists when appuserid === userid
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
        const TWT_LIST_KEY = "list_of_tweets_mid"      // Redis key for user's tweet list
        const PINNED_TWEETS = "pinned_tweet_list"      // Redis key for pinned tweets list
        const BOOKMARK_LIST = "bookmark_list"          // Redis key for user's bookmark list
        const FAVORITE_LIST = "tweet_like_list"        // Redis key for user's favorite list

        const pageNum = parseInt(request["pn"], 10)  // Page number (0-based)
        const pageSize = parseInt(request["ps"], 10)  // Number of tweets per page
        const userId = request["userid"]              // ID of user whose feed to retrieve
        const appUserId = request["appuserid"]        // ID of user requesting the feed

        const mmsid = lapi.MMOpen("", userId, "last")  // Read-only: latest version

        // ========================================================================
        // WRITE SESSION (home node only — needed to clean up stale entries)
        // ========================================================================

        // Only safe to delete stale tweetIds from userId's lists when this node
        // is confirmed to be userId's write/home node (hostIds[0]) — deleting
        // from a stale replica would not be authoritative. Not gated on the
        // requester being the owner: any caller can trigger this cleanup.
        const owner = lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver: "last",
            userid: userId}, [])
        const isHomeNode = !!(owner?.hostIds?.[0] && owner.hostIds[0] === owner.hostIds[1])

        let authSid = null
        let userSid = null
        if (isHomeNode) {
            authSid = lapi.BELoginAsAuthor()
            userSid = lapi.MMOpen(authSid, userId, "cur")
        }

        // ========================================================================
        // MAIN EXECUTION — fetch until full page or feed exhausted
        // ========================================================================

        let validTweets = []
        let originalTweets = []
        let offset = pageNum * pageSize  // Start rank within the sorted set
        let didModify = false

        while (validTweets.length < pageSize) {
            const batch = lapi.Zrevrange(mmsid, FOLLOWINGS_TWEETS, offset, offset + pageSize - 1)
            if (!batch || batch.length === 0) break

            const batchStale = []

            for (const sp of batch) {
                const tweetId = sp.Member
                if (!tweetId) continue

                const tweetResp = lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
                    version: 'v2', appuserid: appUserId, tweetid: tweetId}, [])
                const tweet = tweetResp?.success ? tweetResp.data : null

                if (!tweet) {
                    // Tweet no longer exists — queue for removal from userId's lists
                    if (isHomeNode) batchStale.push(tweetId)
                    continue
                }

                // Filter out private tweets
                if (tweet.isPrivate === true) continue

                validTweets.push(tweet)

                // Collect original tweet for retweets
                if (tweet.originalTweetId) {
                    const origResp = lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
                        version: 'v2', appuserid: appUserId, tweetid: tweet.originalTweetId}, [])
                    const origTweet = origResp?.success ? origResp.data : null
                    if (origTweet) originalTweets.push(origTweet)
                }

                if (validTweets.length >= pageSize) break
            }

            // Remove stale tweet IDs from all user lists
            if (isHomeNode && batchStale.length > 0) {
                batchStale.forEach(tweetId => {
                    lapi.Debug("Tweed get_tweet_feed: removing stale tweetId=%s from user lists, userId=%s", tweetId, userId)
                    lapi.Zrem(userSid, FOLLOWINGS_TWEETS, tweetId)
                    lapi.Zrem(userSid, TWT_LIST_KEY, tweetId)
                    lapi.Hdel(userSid, PINNED_TWEETS, tweetId)
                    lapi.Zrem(userSid, BOOKMARK_LIST, tweetId)
                    lapi.Zrem(userSid, FAVORITE_LIST, tweetId)
                })
                didModify = true
            }

            // Removed items no longer occupy ranks, so adjust offset accordingly
            offset += batch.length - batchStale.length

            // Fewer items than requested means we've reached the end of the feed
            if (batch.length < pageSize) break
        }

        // Persist and publish user data if any stale entries were removed
        if (didModify) {
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
        }

        return wrapResponse({
            success: true,
            tweets: validTweets,
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
