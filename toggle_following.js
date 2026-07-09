/**
 * Toggle Following Status Function
 * 
 * This function manages the follow/unfollow relationship between two users in a distributed
 * social media system. It handles both local and remote user interactions.
 * 
 * Key Operations:
 * - Follow: Adds user to following list, syncs their tweets, and updates follower count
 * - Unfollow: Removes user from following list, cleans up their tweets, and updates counts
 * 
 * Flow:
 * 1. Validates request (prevents self-following)
 * 2. Determines if target user is on local node or remote
 * 3. For remote users: delegates to appropriate node
 * 4. For local users: performs follow/unfollow operations locally
 * 5. Updates user scores and publishes changes
 * 
 * @param {Object} request - The request object containing user and following IDs
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user initiating the follow/unfollow action
 * @param {string} request.followingid - ID of user to follow/unfollow
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || "v2"  // Default to v2 for forward compatibility
    const FOLLOWINGS_TWEETS = "followings_tweets"  // Redis key for user's following tweets feed
    const FOLLOWINGS_LIST = "list_of_followings_mid"  // Redis key for list of followed user IDs
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]          // actor: the user who is following/unfollowing the followingId
    const followingId = request["followingid"]        // target: the user to follow or unfollow
    const followingHostId = request["followingid_hostid"] || null  // host node of followingId (optional hint)
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === undefined || result === null) {
                return {success: false, message: "Operation failed"}
            }
            if (typeof result === 'boolean') {
                return {success: true, data: {isFollowing: result}}
            }
            // Delegated RunMApp("toggle_following") already returns v2 { success, data?, message? }.
            // Do not nest again or clients see ret.data.isFollowing undefined.
            if (result && typeof result === 'object' && ('success' in result)) {
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
        return undefined
    }
    
    // ============================================================================
    // VALIDATION
    // ============================================================================
    
    if (userId === followingId) {
        return wrapError(new Error("Cannot follow yourself"))  // Prevent users from following themselves
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // Initialize system session and get current node information
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        let user
        try {
            user = getUser(userId)  // Get user data to determine hosting node
        } catch(e) {
            lapi.Error("Tweed toggle_following: getUser failed for userId %s, will try hostId hint: %s", userId, e)
        }
        lapi.Debug("Tweed toggle_following: user=%s toggle %s on host=%s", JSON.stringify(user), followingId, followingHostId)
        const userHostId = (Array.isArray(user?.hostIds) && user.hostIds.length > 0)
            ? user.hostIds[0]
            : (request.userid_hostid || null)  // fallback: caller-supplied hint (e.g. post-register auto-follow)

        if (!userHostId) {
            lapi.Error("Tweed toggle_following: missing host for user %s", JSON.stringify({userId, nodeId}))
            return wrapError(new Error("User host not found for user " + userId + " on "+ nodeId))
        }

        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (userHostId !== nodeId) {
            // User is hosted on a different node - delegate the request
            let ret
            try {
                ret = lapi.RunMApp("toggle_following", {aid: APP_ID, ver: "last",
                    nid: userHostId, sid: systemSid,
                    version: version,
                    userid: userId, followingid: followingId,
                    followingid_hostid: followingHostId}, []
                )
            } catch(e) {
                lapi.Error("Tweed toggle_following: Failed to call toggle_following on remote node %s: %s, userId=%s, followingId=%s", userHostId, e, userId, followingId)
                throw e
            }
            
            // Update user's score on the remote node
            try {
                lapi.RunMApp("node_update_mid_by_score", {aid: APP_ID, ver:"last",
                    hostid: userHostId, userid: userId, mid: userId}, [])
            } catch(e) {
                lapi.Error("Tweed toggle_following: Failed to update user score on remote node %s: %s, userId=%s", userHostId, e, userId)
                // Don't throw - this is a non-critical operation
            }
                
            lapi.Debug("Tweed Toggle following remote: ret=%s, user: %s, followed: %s, node: %s", JSON.stringify(ret), userId, followingId, nodeId)
            return wrapResponse(ret)
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            const authSid = lapi.BELoginAsAuthor()

            // Get the user to be followed/unfollowed
            let followedUser = getUser(followingId)
            lapi.Debug("Tweed toggle_following: followed user=%s with id=%s", JSON.stringify(followedUser), followingId)
            if (!followedUser) {
                // Target user not available locally - attempt to sync; use known host nid if available
                try {
                    lapi.MiMeiSync(authSid, "", followingId, {SourcePeer: followingHostId})
                    lapi.MiMeiProvide(authSid, "", followingId)
                } catch(e) {
                    lapi.Error("Tweed toggle_following: Failed to sync followed user %s from nid=%s: %s", followingId, followingHostId, e)
                }

                followedUser = getUser(followingId)

                if (!followedUser) {
                    lapi.Error("Tweed Error toggle_following: cannot get followed user %s after sync (nid=%s)", followingId, followingHostId)
                    return wrapError(new Error("Cannot get followed user"))
                }
            }
            const hostOfOther = Array.isArray(followedUser?.hostIds) && followedUser.hostIds.length > 0
                ? followedUser.hostIds[0]
                : null  // Node hosting the target user

            if (!hostOfOther) {
                lapi.Error("Tweed Error toggle_following: missing host for followed user %s", JSON.stringify({userId, followingId}))
                return wrapError(new Error("Missing host for followed user"))
            }

            // ====================================================================
            // DETERMINE CURRENT FOLLOWING STATUS
            // ====================================================================
            
            // Check if the target user is already in the following list
            let userSid = lapi.MMOpen(authSid, userId, "last")
            const isFollowing = lapi.Hget(userSid, FOLLOWINGS_LIST, followingId) ? true : false
            if (isFollowing) {
                // ================================================================
                // UNFOLLOW OPERATION
                // ================================================================
                
                lapi.Debug("Tweed toggle_following: %s unfollowing %s. Host: %s, Node: %s", userId, followingId, hostOfOther, nodeId)
                
                // Get all tweet IDs from the user being unfollowed
                const tweetsResult = lapi.RunMApp("get_tweet_id_list",
                    {aid: APP_ID, ver: "last", userid: followingId}, [])
                const midList = Array.isArray(tweetsResult)
                    ? tweetsResult.map(e => e.Member).filter(Boolean)
                    : []
                
                // Remove all their tweets from the following feed
                userSid = lapi.MMOpen(authSid, userId, "cur")
                if (midList.length > 0) {
                    lapi.Zrem(userSid, FOLLOWINGS_TWEETS, ...midList)
                }
                
                // Remove user from following list
                lapi.Hdel(userSid, FOLLOWINGS_LIST, followingId)
                
                // Backup user data and publish changes
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)
                // Update follower count on the target user's node
                try {
                    lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                        nid: hostOfOther, sid: systemSid,
                        version: version,
                        userid: followingId, otherid: userId, isfollower: false
                    }, [])
                    
                    // Note: Do not unprovide the target user yet. Wait until Leither is ready.
                    // This prevents premature cleanup of user data that might still be needed.
                    // if (hostOfOtherId != nodeId) {
                    //     lapi.MiMeiUnprovide(authSid, "", otherId)
                    // }
                } catch(e) {
                    lapi.Error("Tweed Error toggle_follower: %s, %s", e, JSON.stringify(request))
                }
            } else {
                // ================================================================
                // FOLLOW OPERATION
                // ================================================================
                
                lapi.Debug("Tweed toggle_following: %s following %s, host: %s, node: %s", userId, followingId, hostOfOther, nodeId)
                
                // Add user to following list with timestamp
                userSid = lapi.MMOpen(authSid, userId, "cur")
                lapi.Hset(userSid, FOLLOWINGS_LIST, followingId, Date.now())

                // Get all existing tweets from the user being followed
                const scorepairs = lapi.RunMApp("get_tweet_id_list", {aid: APP_ID, ver: "last",
                    nid: hostOfOther, sid: systemSid,
                    version: version, userid: followingId
                }, [])
                const normalizedScorepairs = Array.isArray(scorepairs) ? scorepairs : []
                
                // Add all their tweets to the following feed
                if (normalizedScorepairs.length > 0) {
                    lapi.Zadd(userSid, FOLLOWINGS_TWEETS, ...normalizedScorepairs)
                }
                
                // Backup user data and publish changes
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)

                // Sync and provide the target user's content locally
                try {
                    lapi.MiMeiSync(authSid, "", followingId, {SourcePeer: followingHostId})
                    lapi.MiMeiProvide(authSid, "", followingId)
                } catch(e) {
                    lapi.Error("Tweed toggle_following: Failed to sync followed user %s: %s", followingId, e)
                }

                // Update follower count on the target user's node
                try {
                    lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                        nid: hostOfOther, sid: systemSid,
                        version: version,
                        userid: followingId, otherid: userId, isfollower: true
                    }, [])
                } catch(e) {
                    lapi.Error("Tweed Error toggle_following: toggle_follower failed: %s, %s", e, JSON.stringify(request))
                }

            }
    
            // Update the user's score in the application data
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver: "last",
                userid: userId, mid: userId}, [])
            
            // Return the new following status (true if now following, false if unfollowed)
            return wrapResponse(!isFollowing)
        }
    } catch(e) {
        lapi.Error("Tweed Error toggle_following: %s, request=%s", e, JSON.stringify(request))
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
            lapi.Error("Tweed toggle_following: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)
