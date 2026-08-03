/**
 * Get Tweet ID List Function
 * 
 * This function retrieves a list of public tweet IDs for a specific user.
 * It filters out private tweets and returns only public content to ensure
 * reliable and appropriate data access.
 * 
 * Key Features:
 * - Returns only public tweets (filters private content)
 * - Retrieves tweet IDs with score pairs for chronological ordering
 * - Retrieves the user's complete public tweet history
 * - Handles error cases gracefully
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.userid - ID of user whose tweets to retrieve
 * @param {Array} args - Additional arguments (unused)
 * @returns {Array} Array of score pairs containing tweet IDs and timestamps
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const TWT_CONTENT_KEY = "core_data_of_tweet"  // Key for tweet content storage
    const TWT_LIST_KEY = "list_of_tweets_mid"  // Redis key for user's tweet list
    const userId = request["userid"]  // ID of user whose tweets to retrieve
    
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
        const mmsid = lapi.MMOpen("", userId, "last")  // Open user's memory space
        
        // Get the complete tweet list, newest first.
        const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, 0, -1)
        
        // Filter to include only public tweets
        const filteredArr = arr.map(element => {
            // Skip elements with invalid Member (null, undefined, or empty string)
            if (!element || !element.Member) {
                return null
            }
            try {
                const mmsid = lapi.MMOpen("", element.Member, "last")  // Open tweet's memory space
                const tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)  // Get tweet content
                if (tweet && !tweet.isPrivate) {
                    // Only return the tweet if it is public
                    return element
                }
            } catch(e) {
                lapi.Error("Tweed Error get_tweet_id_list: %s, request=%s", e, JSON.stringify(request))
                return null
            }
        }).filter(e => e)  // Remove null/undefined results
        
        return wrapResponse(filteredArr)  // Return the filtered list of score pairs
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_tweet_id_list: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)
