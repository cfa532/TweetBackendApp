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
 * - Missing tweets are returned as null (occupying their slot) rather
 *   than being dropped from the response
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
        const userId = request["userid"]              // ID of user whose feed to retrieve
        const appUserId = request["appuserid"]        // ID of user requesting the feed

        const mmsid = lapi.MMOpen("", userId, "last")  // Read-only: latest version

        // ========================================================================
        // MAIN EXECUTION — one bounded Zrevrange, one output slot per raw entry
        // ========================================================================
        //
        // PAGINATION CONTRACT: the client (see TweetListView.swift) infers "more
        // pages exist" purely from response array LENGTH vs pageSize — it does not
        // look at how many entries were actually valid. That only holds if this
        // array always reflects exactly what Zrevrange found in [offset, offset+
        // pageSize-1] at query time: one slot per raw entry, null for anything
        // that doesn't resolve to a visible tweet (stale/private), never fewer
        // slots than were actually scanned.
        //
        // A prior version of this function instead looped, expanding the scan
        // window to keep pulling more batches until it had a full page of VALID
        // tweets, silently dropping stale/private ones instead of emitting a null
        // for them. That meant each request's offset (pageNum * pageSize,
        // computed fresh client-side) could drift out of sync with the true
        // remaining content: a page could come back with fewer than pageSize
        // items — a false "end of feed" — while entries skipped over by the
        // drift were still sitting there, reachable on a later page/refresh.
        // Single bounded batch + null placeholders side-steps this: since we
        // only report on the exact range requested, the array length only
        // ever reflects that single request's Zrevrange result.
        const offset = pageNum * pageSize  // Start rank within the sorted set
        const batch = lapi.Zrevrange(mmsid, FOLLOWINGS_TWEETS, offset, offset + pageSize - 1) || []

        const originalTweets = []

        // Fetches the tweet from the current access node. A missing tweet is
        // represented by null; routine feed reads must not perform synchronous
        // DHT recovery because that can block the entire feed response.
        function fetchTweet(tweetId) {
            const tweetResp = lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
                version: 'v2', appuserid: appUserId, tweetid: tweetId}, [])
            return tweetResp?.success ? tweetResp.data : null
        }

        const tweets = batch.map(sp => {
            const tweetId = sp.Member
            if (!tweetId) return null

            const tweet = fetchTweet(tweetId)

            if (!tweet) {
                // Still unavailable from the access node — occupy this slot
                // with null so the response length matches what was actually
                // scanned.
                return null
            }

            // Filter out private tweets, but still occupy the slot.
            if (tweet.isPrivate === true) return null

            // Collect original tweet for retweets
            if (tweet.originalTweetId) {
                const origResp = lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
                    version: 'v2', appuserid: appUserId, tweetid: tweet.originalTweetId}, [])
                const origTweet = origResp?.success ? origResp.data : null
                if (origTweet) originalTweets.push(origTweet)
            }

            return tweet
        })

        return wrapResponse({
            success: true,
            tweets: tweets,
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
