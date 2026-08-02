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
 * - Missing tweets are returned as null and tracked as inaccessible;
 *   they are only evicted from FOLLOWINGS_TWEETS after
 *   FAILED_SYNC_REMOVAL_ATTEMPTS failed reads spanning at least
 *   FAILED_SYNC_REMOVAL_AGE_MS (same grace-period pattern as
 *   update_following_tweets.js)
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
        const FAILED_TWEET_SYNCS = "failed_tweet_syncs"  // per-tweetId sync-retry tracking on userId's home object
        // See update_following_tweets.js's FAILED_FOLLOWING_ACCESSES for the same grace-period pattern.
        const FAILED_SYNC_REMOVAL_ATTEMPTS = 7
        const FAILED_SYNC_REMOVAL_AGE_MS = 24 * 60 * 60 * 1000

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
        // Failure here must not break the feed response itself (backward compat
        // with callers that predate this cleanup), so it's isolated in its own
        // try/catch and simply falls back to skipping cleanup.
        let isHomeNode = false
        try {
            const owner = lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver: "last",
                userid: userId}, [])
            isHomeNode = !!(owner?.hostIds?.[0] && owner.hostIds[0] === owner.hostIds[1])
        } catch (e) {
            lapi.Error("Tweed get_tweet_feed: get_user_core_data failed for userId=%s: %s", userId, e)
        }

        let authSid = null
        let userSid = null
        if (isHomeNode) {
            try {
                authSid = lapi.BELoginAsAuthor()
                userSid = lapi.MMOpen(authSid, userId, "cur")
            } catch (e) {
                lapi.Error("Tweed get_tweet_feed: failed to open write session for userId=%s: %s", userId, e)
                authSid = null
                userSid = null
                isHomeNode = false
            }
        }

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
        // for them. Combined with the stale-tweet Zrem cleanup below — which
        // permanently shifts down the rank of every later item in the sorted set
        // — that meant each request's offset (pageNum * pageSize, computed fresh
        // client-side with no knowledge of prior requests' Zrem calls) drifted out
        // of sync with the true remaining content. The set's rank space shrinks a
        // little every time a stale tweet is cleaned up, but the client keeps
        // asking for rank pageNum*pageSize as if it hadn't. Once that drift pushed
        // an offset far enough forward, a page could come back with fewer than
        // pageSize items — a false "end of feed" — while entries skipped over by
        // the drift were still sitting there, reachable on a later page/refresh.
        // Single bounded batch + null placeholders side-steps this: since we only
        // report on the exact range requested and never depend on rank stability
        // across requests, the array length only ever reflects that single
        // request's Zrevrange result, regardless of what any request before it
        // may have cleaned up.
        const offset = pageNum * pageSize  // Start rank within the sorted set
        const batch = lapi.Zrevrange(mmsid, FOLLOWINGS_TWEETS, offset, offset + pageSize - 1) || []

        const originalTweets = []
        let didModify = false

        // Fetches the tweet from the current access node. A missing tweet is
        // represented by null; routine feed reads must not perform synchronous
        // DHT recovery because that can block the entire feed response.
        function fetchTweet(tweetId) {
            const tweetResp = lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
                version: 'v2', appuserid: appUserId, tweetid: tweetId}, [])
            return tweetResp?.success ? tweetResp.data : null
        }

        // Records an unreachable tweetId on the calling user's home object.
        // The tweetId is removed from FOLLOWINGS_TWEETS only after both the
        // age and attempt thresholds — same grace-period shape as
        // update_following_tweets.js's recordFollowingAccessFailure.
        function recordTweetSyncFailure(tweetId) {
            try {
                const now = Date.now()
                const previous = lapi.Hget(userSid, FAILED_TWEET_SYNCS, tweetId)
                const hasValidPrevious = previous && typeof previous === "object" &&
                    typeof previous.firstFailedAt === "number" &&
                    Number.isFinite(previous.firstFailedAt) &&
                    previous.firstFailedAt > 0 && previous.firstFailedAt <= now &&
                    typeof previous.lastFailedAt === "number" &&
                    Number.isFinite(previous.lastFailedAt) &&
                    previous.lastFailedAt >= previous.firstFailedAt &&
                    previous.lastFailedAt <= now &&
                    Number.isSafeInteger(previous.attempts) &&
                    previous.attempts >= 1 && previous.attempts < Number.MAX_SAFE_INTEGER
                const firstFailedAt = hasValidPrevious ? previous.firstFailedAt : now
                const attempts = hasValidPrevious ? previous.attempts + 1 : 1

                if (attempts >= FAILED_SYNC_REMOVAL_ATTEMPTS &&
                    now - firstFailedAt > FAILED_SYNC_REMOVAL_AGE_MS) {
                    // Clear the failure record first. If removing the tweetId
                    // then fails, the partial state is conservative: the
                    // tweetId stays and its grace period restarts on the next
                    // failed sync.
                    lapi.Hdel(userSid, FAILED_TWEET_SYNCS, tweetId)
                    didModify = true
                    lapi.Zrem(userSid, FOLLOWINGS_TWEETS, tweetId)
                    lapi.Warn("Tweed get_tweet_feed: removed unrecoverable tweetId=%s from FOLLOWINGS_TWEETS after %d attempts, firstFailedAt=%s, userId=%s",
                        tweetId, attempts, String(firstFailedAt), userId)
                    return
                }

                lapi.Hset(userSid, FAILED_TWEET_SYNCS, tweetId, {
                    firstFailedAt: firstFailedAt,
                    lastFailedAt: now,
                    attempts: attempts
                })
                didModify = true
            } catch (e) {
                lapi.Error("Tweed get_tweet_feed: failed to record tweet sync failure: %s, tweetId=%s, userId=%s", e, tweetId, userId)
            }
        }

        // A single successful sync/fetch clears all prior failure history.
        function clearTweetSyncFailure(tweetId) {
            try {
                const previous = lapi.Hget(userSid, FAILED_TWEET_SYNCS, tweetId)
                if (previous !== null && previous !== undefined) {
                    lapi.Hdel(userSid, FAILED_TWEET_SYNCS, tweetId)
                    didModify = true
                }
            } catch (e) {
                lapi.Error("Tweed get_tweet_feed: failed to clear tweet sync failure: %s, tweetId=%s, userId=%s", e, tweetId, userId)
            }
        }

        const tweets = batch.map(sp => {
            const tweetId = sp.Member
            if (!tweetId) return null

            const tweet = fetchTweet(tweetId)

            if (!tweet) {
                // Still unavailable from the access node — record the failure
                // (and evict from FOLLOWINGS_TWEETS once thresholds are met),
                // but still occupy this slot with null so the response length
                // matches what was actually scanned.
                if (isHomeNode && userSid) recordTweetSyncFailure(tweetId)
                return null
            }

            // Recovered (first try or after sync) — clear any failure history
            // so a future transient miss starts counting from zero.
            if (isHomeNode && userSid) clearTweetSyncFailure(tweetId)

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

        // Persist and publish user data if any failure bookkeeping or
        // eviction happened above. Best-effort: a failure here must not
        // break the feed response, since tweets were already fetched
        // successfully. Safe to do after building `tweets` since the
        // response no longer depends on rank stability post-cleanup.
        if (didModify) {
            try {
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)
            } catch (e) {
                lapi.Error("Tweed get_tweet_feed: failed to persist/publish cleanup for userId=%s: %s", userId, e)
            }
        }

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
