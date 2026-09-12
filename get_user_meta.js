/**
 * Get User Meta Function
 * 
 * This function retrieves user metadata including bookmarks, favorites, and comments.
 * It supports pagination and returns different data types based on the request type.
 * Saved tweets are read from the current node without forcing synchronization.
 * On the user's root node, old memberships whose tweets are still missing are
 * removed after a grace period so a newly saved tweet is not mistaken as stale
 * while its content is being synchronized.
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
        } else if (request['type'] === 'bookmark_list' || request['type'] === 'favorite_list') {
            // Return tweets (bookmarks or favorites) as tweet objects
            return wrapResponse(getTweets(request['type']));
        }
        throw new Error(`Unsupported user metadata type: ${request['type']}`)
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
        const OWNER_DATA_KEY = "data_of_author"
        const SAVED_ITEM_SYNC_GRACE_MS = 5 * 60 * 1000
        const mmsid = lapi.MMOpen('', userId, 'last')
        const nodeId = lapi.GetVar("", "hostid")
        let isRootNode = false
        try {
            const owner = lapi.Get(mmsid, OWNER_DATA_KEY)
            isRootNode = !!(owner?.hostIds?.[0] && owner.hostIds[0] === nodeId)
        } catch (e) {
            // A failed ownership check must degrade to a read-only response,
            // never prevent the saved list itself from loading.
            lapi.Error("Tweed get_user_meta: failed to resolve root node for userId=%s: %s", userId, e)
        }

        let authSid = null
        let userSid = null
        function getWritableUserSid() {
            if (!isRootNode) return null
            if (userSid) return userSid

            try {
                authSid = lapi.BELoginAsAuthor()
                userSid = lapi.MMOpen(authSid, userId, "cur")
                return userSid
            } catch (e) {
                lapi.Error("Tweed get_user_meta: failed to open write session for userId=%s: %s", userId, e)
                authSid = null
                userSid = null
                isRootNode = false
                return null
            }
        }

        // Routine reads must remain local and fast. Explicit recovery APIs own
        // synchronization; this list read only reports or removes local misses.
        function fetchTweet(tweetId) {
            return lapi.RunMApp('get_tweet', { aid: request.aid, ver: 'last',
                appuserid: appUserId, tweetid: tweetId }, [])
        }

        let didModify = false

        // Get all items, sort by timestamp the tweet is added to the list (newest first), and paginate
        const allItems = lapi.Hgetall(mmsid, tweetType)
            .sort((a, b) => b.Value - a.Value)
        const arr = []

        // When a stale membership is removed, keep scanning so the caller
        // still receives a full page and the next page does not skip an item
        // shifted by the deletion.
        for (let index = startRank; index < allItems.length && arr.length < pageSize; index++) {
            const item = allItems[index]
            const tweetId = item.Field
            const tweet = fetchTweet(tweetId)
            if (tweet) {
                arr.push(tweet)
                continue
            }

            // Access nodes never mutate the user's saved lists. Invalid or
            // recent timestamps are also preserved because they cannot prove
            // that the content synchronization window has elapsed.
            const savedAt = Number(item.Value)
            if (!isRootNode || !Number.isFinite(savedAt) ||
                Date.now() - savedAt < SAVED_ITEM_SYNC_GRACE_MS
            ) {
                arr.push(null)
                continue
            }

            const writableUserSid = getWritableUserSid()
            if (!writableUserSid) {
                arr.push(null)
                continue
            }

            // Re-read membership from the writable session. A changed
            // timestamp means the item was re-added after this page snapshot.
            const currentValue = lapi.Hget(writableUserSid, tweetType, tweetId)
            if (currentValue === null || currentValue === undefined) {
                continue
            }
            const currentSavedAt = Number(currentValue)
            if (!Number.isFinite(currentSavedAt) || currentSavedAt !== savedAt) {
                arr.push(null)
                continue
            }

            // Content may have arrived after the first lookup. Check once more
            // immediately before deleting the unchanged, old membership.
            const availableTweet = fetchTweet(tweetId)
            if (availableTweet) {
                arr.push(availableTweet)
                continue
            }

            lapi.Hdel(writableUserSid, tweetType, tweetId)
            didModify = true
            lapi.Warn("Tweed get_user_meta: removed stale tweetId=%s from %s on root node=%s, savedAt=%s, userId=%s",
                tweetId, tweetType, nodeId, String(savedAt), userId)
        }

        // Persist and publish root-node cleanup once after the page is built.
        if (didModify) {
            try {
                lapi.MMBackup(userSid, userId, "", "delref=false")
                lapi.MiMeiPublish(authSid, "", userId)
            } catch (e) {
                lapi.Error("Tweed get_user_meta: failed to persist/publish cleanup for userId=%s: %s", userId, e)
            }
        }

        return arr;
    }
})(request, args);
