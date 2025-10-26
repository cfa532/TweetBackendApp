/**
 * Get User Core Data Function
 * 
 * This function retrieves comprehensive user profile data including engagement
 * metrics and statistics. It provides a complete user profile with counts for
 * tweets, followers, following, bookmarks, favorites, and comments.
 * 
 * Key Features:
 * - Retrieves complete user profile data
 * - Calculates engagement metrics and counts
 * - Removes sensitive data (password)
 * - Handles missing users gracefully
 * - Provides comprehensive user statistics
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.userid - ID of user whose data to retrieve
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object|null} Complete user object with statistics, or null if not found
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    try {
        const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
        const TWT_LIST_KEY = "list_of_tweets_mid"  // Redis key for user's tweet list
        const FOLLOWINGS_LIST = "list_of_followings_mid"  // Redis key for following list
        const FOLLOWERS_LIST = "list_of_followers_mid"  // Redis key for followers list
        const COMMENT_LIST = "comment_list"  // Redis key for user's comments
        const BOOKMARK_LIST = "bookmark_list"  // Redis key for user's bookmarks
        const FAVORITE_LIST = "favorite_list"  // Redis key for user's favorites

        const userId = request["userid"]  // ID of user whose data to retrieve
        const mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space
        const user = lapi.Get(mmsid, OWNER_DATA_KEY)  // Get user data
        
        if (!user) {
            console.warn("get_user_core_data: User", userId, "not found on node", lapi.GetVar("", "hostid"))
            return null
        }

        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Add engagement metrics and statistics to user object
        user["tweetCount"] = lapi.Zcard(mmsid, TWT_LIST_KEY)  // Number of tweets
        user["followingCount"] = lapi.Hlen(mmsid, FOLLOWINGS_LIST)  // Number of following
        user["followersCount"] = lapi.Hlen(mmsid, FOLLOWERS_LIST)  // Number of followers
        user["bookmarksCount"] = lapi.Hlen(mmsid, BOOKMARK_LIST)  // Number of bookmarks
        user["favoritesCount"] = lapi.Hlen(mmsid, FAVORITE_LIST)  // Number of favorites
        user["commentsCount"] = lapi.Hlen(mmsid, COMMENT_LIST)  // Number of comments
        
        // Remove sensitive data before returning
        delete user.password
        return user
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("ERROR get_user_core_data", JSON.stringify(request), e)
        return null
    }
})(request, args)