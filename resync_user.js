/**
 * Resync User Function
 * 
 * This function ensures the current node has the most up-to-date version of a user
 * by syncing the user data from their primary host before retrieving it. Unlike
 * get_user, this function guarantees fresh user data by performing synchronization.
 * 
 * Key Features:
 * - Syncs user data from primary host to ensure current information
 * - Updates user content and returns newly synced tweets
 * - Handles both local and remote user synchronization
 * - Returns fresh user data with updated information
 * - Ensures data consistency across distributed nodes
 * 
 * @param {Object} request - The request object containing user data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user to resync
 * @param {string} [request.appuserid] - Current app user ID, used by get_tweet to compute viewer-specific flags
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object|null} Fresh user data object, or v3 {user, tweets} with newly synced tweets
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const userId = request["userid"]  // ID of user to resync
    const appUserId = request["appuserid"] || request["author"] || userId
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === null || result === undefined) {
                return {success: false, message: "User not found"}
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

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const user = getUser(userId)  // Get user data to determine hosting node
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier

        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed resync_user: missing host for user %s", JSON.stringify({userId, nodeId, user}))
            throw new Error("User not found or missing host")
        }

        lapi.Debug("Tweed resync_user: start userId=%s nodeId=%s hostIds=%s version=%s", userId, nodeId, JSON.stringify(user.hostIds), version)

        // ========================================================================
        // USER SYNCHRONIZATION
        // ========================================================================

        const TWT_LIST_KEY = "list_of_tweets_mid"
        const tweets = []

        if (user.hostIds[0] !== nodeId) {
            if (version === 'v3') {
                // Temporary conservative scan: browse the full recent tweet list
                // and sync every tweet missing locally. To restore the faster
                // boundary behavior later, change the `if (tweet) continue`
                // below to `if (tweet) break`, so the first valid local tweet
                // means this copy has already caught up to that point.
                const userSid = lapi.MMOpen("", userId, "last")
                const tweetIdList = lapi.Zrevrange(userSid, TWT_LIST_KEY, 0, 19) || []
                lapi.Debug("Tweed resync_user v3: userId=%s tweetIdList.length=%d", userId, tweetIdList.length)

                for (const element of tweetIdList) {
                    if (!element || !element.Member) {
                        lapi.Debug("Tweed resync_user v3: skipping null/empty element userId=%s", userId)
                        continue
                    }
                    const tweetId = element.Member

                    let tweet = lapi.RunMApp("get_tweet", {
                        aid: request["aid"],
                        ver: "last",
                        tweetid: tweetId,
                        appuserid: appUserId,
                        version: 'v3'
                    }, [])

                    lapi.Debug("Tweed resync_user v3: tweet not local, syncing tweetId=%s userId=%s hostId=%s", tweetId, userId, user.hostIds[0])
                    let syncFailed = false
                    try {
                        const authSid = lapi.BELoginAsAuthor()
                        lapi.MiMeiSync(authSid, "", tweetId, {SourcePeer: user.hostIds[0]})
                        lapi.MiMeiProvide(authSid, "", tweetId)
                    } catch(syncErr) {
                        lapi.Error("Tweed resync_user v3: MiMeiSync failed tweetId=%s userId=%s hostId=%s err=%s", tweetId, userId, user.hostIds[0], syncErr)
                        syncFailed = true
                    }

                    if (syncFailed) {
                        lapi.Error("Tweed resync_user v3: sync failed, skipping tweetId=%s userId=%s tweets.length=%d", tweetId, userId, tweets.length)
                        continue
                    }

                    tweet = lapi.RunMApp("get_tweet", {
                        aid: request["aid"],
                        ver: "last",
                        tweetid: tweetId,
                        appuserid: appUserId,
                        version: 'v3'
                    }, [])

                    if (tweet) {
                        lapi.Debug("Tweed resync_user v3: tweet synced and fetched tweetId=%s userId=%s", tweetId, userId)
                        tweets.push(tweet)
                    } else {
                        lapi.Error("Tweed resync_user v3: tweet still missing after sync tweetId=%s userId=%s", tweetId, userId)
                    }
                }
                lapi.Debug("Tweed resync_user v3: tweet sync done userId=%s synced=%d", userId, tweets.length)
            } else {
                // Make sure the current user is up to date by syncing from primary host
                lapi.Debug("Tweed resync_user: syncing user mid userId=%s hostId=%s", userId, user.hostIds[0])
                lapi.RunMApp("node_update_mid_by_score", {aid: request["aid"], ver:"last",
                    hostid: user.hostIds[0], userid: userId, mid: userId}, [])
            }
        }

        // ========================================================================
        // FRESH USER DATA RETRIEVAL
        // ========================================================================

        // Get the fresh user data after synchronization
        const userData = lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last",
            userid: userId}, [])

        if (!userData) {
            lapi.Error("Tweed resync_user: get_user_core_data returned null userId=%s", userId)
            throw new Error("Failed to retrieve user data after synchronization")
        }

        lapi.Debug("Tweed resync_user: done userId=%s version=%s tweets=%d", userId, version, tweets.length)
        if (version === 'v3') {
            return wrapResponse({user: userData, tweets})
        }
        return wrapResponse(userData)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================

        lapi.Error("Tweed Error resync_user: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Retrieves user data from the system
     * @param {string} mid - User ID to retrieve data for
     * @returns {Object|null} User data object or null if not found
     */
    function getUser(mid) {
        try {
            const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
            const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
            return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
        } catch(e) {
            lapi.Error("Tweed resync_user: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)
