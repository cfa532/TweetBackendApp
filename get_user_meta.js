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
        const mmsid = lapi.MMOpen('', userId, 'last');

        // Get all items, sort by timestamp the tweet is added to the list (newest first), and paginate
        const allItems = lapi.Hgetall(mmsid, tweetType);
        const arr = allItems
            .sort((a, b) => b.Value - a.Value)
            .slice(startRank, endRank)  // Slice to get only the items for the current page
            .map(fv => {
                const tweetId = fv.Field;
                const t = lapi.RunMApp('get_tweet', { aid: request.aid, ver: 'last',
                    appuserid: appUserId, tweetid: tweetId }, []);
                return t;
            })

        return arr;
    }
})(request, args);