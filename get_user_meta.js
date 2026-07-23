/**
 * Get User Meta Function
 * 
 * This function retrieves user metadata including bookmarks, favorites, and comments.
 * It supports pagination and returns different data types based on the request type.
 * All tweets should be synced to the user's node before retrieving the list.
 * 
 * Key Features:
 * - Retrieves user bookmarks, favorites, and comments
 * - Supports pagination for large datasets
 * - Returns different data formats based on type
 * - Sorts data by timestamp (newest first)
 * - Handles error cases gracefully
 * 
 * @param {Object} request - The request object containing query parameters
 * @param {string} request.userid - ID of user whose metadata to retrieve
 * @param {string} request.appuserid - ID of user requesting the metadata
 * @param {string} request.type - Type of metadata ('comment', 'bookmark', 'favorite')
 * @param {number} request.pn - Page number (0-based)
 * @param {number} request.ps - Page size (number of items per page)
 * @param {Array} args - Additional arguments (unused)
 * @returns {Array} Array of metadata items or field-value pairs
 */

((request, args) => {
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const COMMENT_LIST = 'comment_list';  // Redis key for user's comments
    const userId = request['userid'];  // ID of user whose metadata to retrieve
    const appUserId = request['appuserid'];  // ID of user requesting the metadata
    const pageNumber = parseInt(request['pn'], 10);  // Page number (0-based)
    const pageSize = parseInt(request['ps'], 10);  // Number of items per page
    const startRank = pageNumber * pageSize;  // Starting index for pagination
    const endRank = startRank + pageSize;  // Ending index for pagination (exclusive for slice)
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error, data: []}
        }
        return []
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        if (request['type'] === COMMENT_LIST) {
            // Return comments as field-value pairs
            const mmsid = lapi.MMOpen('', userId, 'last');
            return wrapResponse(lapi.Hgetall(mmsid, COMMENT_LIST));
        } else {
            // Return tweets (bookmarks or favorites) as tweet objects
            return wrapResponse(getTweets(request['type']));
        }
    } catch (e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error('Tweed Error get_user_meta: %s, request=%s', e, JSON.stringify(request));
        return wrapError(e);
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Retrieves tweets for a specific type (bookmarks or favorites)
     * @param {string} tweetType - Type of tweets to retrieve ('bookmark_list' or 'favorite_list')
     * @returns {Array} Array of tweet objects
     */
    function getTweets(tweetType) {
        const FAILED_TWEET_SYNCS = "failed_tweet_syncs"  // per-tweetId sync-retry tracking on userId's home object
        // See update_following_tweets.js's FAILED_FOLLOWING_ACCESSES for the same grace-period pattern.
        const FAILED_SYNC_REMOVAL_ATTEMPTS = 7
        const FAILED_SYNC_REMOVAL_AGE_MS = 24 * 60 * 60 * 1000

        const mmsid = lapi.MMOpen('', userId, 'last');

        // Only safe to evict stale tweetIds from userId's tweetType list when
        // this node is confirmed to be userId's write/home node (hostIds[0]).
        // Failure here must not break the meta response, so it's isolated in
        // its own try/catch and simply falls back to skipping cleanup.
        let isHomeNode = false
        try {
            const owner = lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver: "last",
                userid: userId}, [])
            isHomeNode = !!(owner?.hostIds?.[0] && owner.hostIds[0] === owner.hostIds[1])
        } catch (e) {
            lapi.Error("Tweed get_user_meta: get_user_core_data failed for userId=%s: %s", userId, e)
        }

        let authSid = null
        let userSid = null
        if (isHomeNode) {
            try {
                authSid = lapi.BELoginAsAuthor()
                userSid = lapi.MMOpen(authSid, userId, "cur")
            } catch (e) {
                lapi.Error("Tweed get_user_meta: failed to open write session for userId=%s: %s", userId, e)
                authSid = null
                userSid = null
                isHomeNode = false
            }
        }

        // Fetches the tweet; on a miss, tries to sync it from the DHT before
        // giving up — a miss can mean the tweet was deleted, or just that it
        // hasn't propagated to this node yet.
        function fetchTweet(tweetId) {
            return lapi.RunMApp('get_tweet', { aid: request.aid, ver: 'last',
                appuserid: appUserId, tweetid: tweetId }, []);
        }

        function trySyncAndRefetch(tweetId) {
            try {
                const systemSid = lapi.BEOpenAppDataNode("cur", request["aid"])
                lapi.MiMeiSync(systemSid, "", tweetId, {})
                lapi.MiMeiProvide(systemSid, "", tweetId)
            } catch (e) {
                lapi.Error("Tweed get_user_meta: sync failed for tweetId=%s: %s", tweetId, e)
                return null
            }
            return fetchTweet(tweetId)
        }

        let didModify = false

        // Records an unreachable tweetId on the calling user's home object.
        // The tweetId is removed from tweetType only after both the age and
        // attempt thresholds — same grace-period shape as
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
                    lapi.Hdel(userSid, tweetType, tweetId)
                    lapi.Warn("Tweed get_user_meta: removed unrecoverable tweetId=%s from %s after %d attempts, firstFailedAt=%s, userId=%s",
                        tweetId, tweetType, attempts, String(firstFailedAt), userId)
                    return
                }

                lapi.Hset(userSid, FAILED_TWEET_SYNCS, tweetId, {
                    firstFailedAt: firstFailedAt,
                    lastFailedAt: now,
                    attempts: attempts
                })
                didModify = true
            } catch (e) {
                lapi.Error("Tweed get_user_meta: failed to record tweet sync failure: %s, tweetId=%s, userId=%s", e, tweetId, userId)
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
                lapi.Error("Tweed get_user_meta: failed to clear tweet sync failure: %s, tweetId=%s, userId=%s", e, tweetId, userId)
            }
        }

        // Get all items, sort by timestamp the tweet is added to the list (newest first), and paginate
        const allItems = lapi.Hgetall(mmsid, tweetType);
        const arr = allItems
            .sort((a, b) => b.Value - a.Value)
            .slice(startRank, endRank)  // Slice to get only the items for the current page
            .map(fv => {
                const tweetId = fv.Field;
                let t = fetchTweet(tweetId)
                if (!t) t = trySyncAndRefetch(tweetId)

                if (!t) {
                    // Still unreachable after a sync attempt — record the
                    // failure (and evict from tweetType once thresholds are
                    // met).
                    if (isHomeNode && userSid) recordTweetSyncFailure(tweetId)
                    return null
                }

                // Recovered (first try or after sync) — clear any failure
                // history so a future transient miss starts counting from zero.
                if (isHomeNode && userSid) clearTweetSyncFailure(tweetId)
                return t;
            })

        // Persist and publish user data if any failure bookkeeping or
        // eviction happened above. Best-effort: a failure here must not
        // break the meta response, since tweets were already fetched
        // successfully.
        if (didModify) {
            try {
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)
            } catch (e) {
                lapi.Error("Tweed get_user_meta: failed to persist/publish cleanup for userId=%s: %s", userId, e)
            }
        }

        return arr;
    }
})(request, args);