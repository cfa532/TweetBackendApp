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
    
    const FOLLOWINGS_TWEETS = "followings_tweets"  // Redis key for user's following tweets feed
    const FOLLOWINGS_LIST = "list_of_followings_mid"  // Redis key for list of followed user IDs
    const APP_ID = request["aid"]  // Application identifier
    const userId = request["userid"]  // ID of user initiating the follow/unfollow action
    const followedId = request["followingid"]  // ID of user to follow or unfollow
    // ============================================================================
    // VALIDATION
    // ============================================================================
    
    if (userId === followedId) {
        return  // Prevent users from following themselves
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // Initialize system session and get current node information
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
        const user = getUser(userId)  // Get user data to determine hosting node
        const userHostId = Array.isArray(user?.hostIds) && user.hostIds.length > 0
            ? user.hostIds[0]
            : null

        if (!userHostId) {
            lapi.Error("Tweed toggle_following: missing host for user %s", JSON.stringify({userId, nodeId}))
            return
        }

        // ========================================================================
        // REMOTE USER HANDLING
        // ========================================================================
        
        if (userHostId !== nodeId) {
            // User is hosted on a different node - delegate the request
            let ret = lapi.RunMApp("toggle_following", {aid: APP_ID, ver: "last",
                nid: userHostId, sid: systemSid,
                userid: userId, followingid: followedId}, []
            )
            
            // Update user's score on the remote node
            lapi.RunMApp("node_update_mid_by_score", {aid: APP_ID, ver:"last",
                hostid: userHostId, userid: userId, mid: userId}, [])
                
            lapi.Debug("Tweed Toggle following remote: ret=%s, user: %s, followed: %s, node: %s", ret, userId, followedId, nodeId)
            return ret
        } else {
            // ====================================================================
            // LOCAL USER HANDLING
            // ====================================================================
            
            // Initialize user session for local operations
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")

            // Get the user to be followed/unfollowed
            let followedUser = getUser(followedId)
            if (!followedUser) {
                // Target user not available locally - attempt to sync and provide
                lapi.MiMeiSync(authSid, "", followedId, {})
                lapi.MiMeiProvide(authSid, "", followedId)
                followedUser = getUser(followedId)

                if (!followedUser) {
                    lapi.Error("Tweed Error toggle_followings: cannot get followed user %s", followedId)
                    return  // Cannot proceed if target user is unavailable
                }
            }
            const hostOfOther = Array.isArray(followedUser?.hostIds) && followedUser.hostIds.length > 0
                ? followedUser.hostIds[0]
                : null  // Node hosting the target user

            if (!hostOfOther) {
                lapi.Error("Tweed Error toggle_following: missing host for followed user %s", JSON.stringify({userId, followedId}))
                return
            }

            // ====================================================================
            // DETERMINE CURRENT FOLLOWING STATUS
            // ====================================================================
            
            // Check if the target user is already in the following list
            const isFollowing = lapi.Hget(userSid, FOLLOWINGS_LIST, followedId) ? true : false
            if (isFollowing) {
                // ================================================================
                // UNFOLLOW OPERATION
                // ================================================================
                
                lapi.Debug("Tweed toggle_following: %s unfollowing %s. Host: %s, Node: %s", userId, followedId, hostOfOther, nodeId)
                
                // Get all tweet IDs from the user being unfollowed
                const tweetsResult = lapi.RunMApp("get_tweet_id_list",
                    {aid: APP_ID, ver: "last", userid: followedId}, [])
                const midList = Array.isArray(tweetsResult)
                    ? tweetsResult.map(e => e.Member).filter(Boolean)
                    : []
                
                // Remove all their tweets from the following feed
                if (midList.length > 0) {
                    lapi.Zrem(userSid, FOLLOWINGS_TWEETS, ...midList)
                }
                
                // Remove user from following list
                lapi.Hdel(userSid, FOLLOWINGS_LIST, followedId)
                
                // Backup user data and publish changes
                lapi.MMBackup(userSid, userId, "", "delref=true")
                lapi.MiMeiPublish(authSid, "", userId)
                // Update follower count on the target user's node
                try {
                    lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                        nid: hostOfOther, sid: systemSid,
                        userid: followedId, otherid: userId, isfollower: false
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
                
                lapi.Debug("Tweed toggle_following: %s following %s, host: %s, node: %s", userId, followedId, hostOfOther, nodeId)
                
                // Add user to following list with timestamp
                lapi.Hset(userSid, FOLLOWINGS_LIST, followedId, Date.now())

                // Get all existing tweets from the user being followed
                const scorepairs = lapi.RunMApp("get_tweet_id_list", {aid: APP_ID, ver: "last",
                    nid: hostOfOther, sid: systemSid, userid: followedId
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
                lapi.MiMeiSync(authSid, "", followedId, {})
                lapi.MiMeiProvide(authSid, "", followedId)

                // Note: Individual tweet syncing is commented out for performance reasons.
                // The user content sync above should handle most cases. Individual tweet
                // syncing can be enabled if needed for specific use cases.
                // 
                normalizedScorepairs.forEach(sp => {
                    const tweetId = sp.Member
                    const t = lapi.RunMApp("get_tweet", {aid: APP_ID, ver: "last",
                        tweetid: tweetId, appuserid: userId}, [])
                    if (!t) {
                        lapi.Debug("Tweed toggle_following: Syncing tweet: %s, user: %s", tweetId, followedId)
                        lapi.MiMeiSync(authSid, "", tweetId, {})
                        // lapi.MiMeiProvide(authSid, "", tweetId)
                    }
                })

                // Update follower count on the target user's node
                try {
                    lapi.RunMApp("toggle_follower", {aid: APP_ID, ver: "last",
                        nid: hostOfOther, sid: systemSid,
                        userid: followedId, otherid: userId, isfollower: true
                    }, [])
                } catch(e) {
                    lapi.Error("Tweed Error toggle_following: toggle_follower failed: %s, %s", e, JSON.stringify(request))
                }
            }
    
            // ====================================================================
            // CLEANUP AND RETURN
            // ====================================================================
            
            // Update the user's score in the application data
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver: "last",
                userid: userId, mid: userId}, [])
            
            // Return the new following status (true if now following, false if unfollowed)
            return !isFollowing
        }
    } catch(e) {
        lapi.Error("Tweed Error toggle_followings: %s, %s", e, JSON.stringify(request))
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
        const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
        const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
        return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
    }
})(request, args)