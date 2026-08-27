/**
 * Retweet Removed Function
 * 
 * This function updates the retweet list in the original tweet after a user
 * removes their retweet. It handles both local and remote retweet removal,
 * ensuring proper cleanup of retweet tracking and updating tweet scores.
 * 
 * Key Features:
 * - Removes retweet from original tweet's retweet list
 * - Handles both local and remote retweet removal
 * - Updates tweet scores and publishes changes
 * - Returns updated tweet data without retweet information
 * - Manages retweet cleanup across distributed nodes
 * 
 * @param {Object} request - The request object containing retweet removal data
 * @param {string} request.aid - Application ID
 * @param {string} request.tweetid - ID of the original tweet being unretweeted
 * @param {string} request.authorid - ID of the original tweet author
 * @param {string} request.retweetid - ID of the retweet being removed
 * @param {string} request.appuserid - ID of user removing the retweet
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Updated tweet object without retweet information
 */

((request, args) => {
  // ============================================================================
  // CONSTANTS AND INITIALIZATION
  // ============================================================================
  
  const version = request.version || ""  // Version identifier for API compatibility
  
  // Helper function to wrap response in v2 format if needed
  function wrapResponse(result) {
      if (version === 'v2') {
          if (result === null || result === undefined) {
              return {success: false, message: "Retweet removal failed"}
          }
          // If result already has success field (e.g. delegated RunMApp call),
          // return as-is to avoid double-wrapping.
          if (typeof result === 'object' && 'success' in result) {
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
      return null
  }
  
  try {
    const RETWEET_LIST = "tweet_retweet_list"  // Redis key for tweet's retweet list
    const APP_ID = request["aid"]  // Application identifier
    const tweetId = request["tweetid"]  // ID of the original tweet being unretweeted
    const authorId = request["authorid"]  // ID of the original tweet author
    const user = getUser(authorId)  // Get author data to determine hosting node
    const retweetId = request["retweetid"]  // ID of the retweet being removed
    const appUserId = request["appuserid"]  // ID of user removing the retweet
    const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    
    if (!user || !user.hostIds || user.hostIds.length === 0) {
        lapi.Error("Tweed retweet_removed: missing host for author %s", JSON.stringify({authorId, nodeId, user}))
        throw new Error("Author not found or missing host")
    }
    
    // ========================================================================
    // REMOTE AUTHOR HANDLING
    // ========================================================================
    
    if (user.hostIds[0] !== nodeId) {
        // Delegate retweet removal to the node hosting the author
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        let ret
        try {
            ret = lapi.RunMApp("retweet_removed", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                version: version, appuserid: appUserId,
                tweetid: tweetId, authorid: authorId, retweetid: retweetId},
                [])
        } catch(e) {
            lapi.Error("Tweed retweet_removed: Failed to call retweet_removed on remote node %s: %s, authorId=%s, tweetId=%s", user.hostIds[0], e, authorId, tweetId)
            throw e
        }
        return wrapResponse(ret)
    } else {
      // ====================================================================
      // LOCAL AUTHOR HANDLING
      // ====================================================================
      const authSid = lapi.BELoginAsAuthor()
      const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")  // Open original tweet for editing
      
      // ================================================================
      // RETWEET LIST UPDATE
      // ================================================================
      
      // Remove retweet from the original tweet's retweet list
      lapi.Hdel(tweetSid, RETWEET_LIST, retweetId)
      
      // Update tweet data and publish changes
      lapi.MMBackup(authSid, tweetId, "", "delref=false")
      lapi.MiMeiPublish(authSid, "", tweetId)
  
      // ================================================================
      // SCORE UPDATE AND TWEET RETRIEVAL
      // ================================================================
      
      // Update the score of the original tweet in AppData
      lapi.RunMApp("node_update_score", { aid: request["aid"], ver: "last",
        userid: authorId, mid: tweetId}, []
      )
      
      // Retrieve the original tweet after updating it
      const tweetResp = lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
        version: 'v2', appuserid: appUserId, tweetid: tweetId}, []
      )
      const tweet = tweetResp?.success ? tweetResp.data : null
      return wrapResponse(tweet)
    }
  } catch (e) {
    // ========================================================================
    // ERROR HANDLING
    // ========================================================================
    
    lapi.Error("Tweed Error retweet_removed: %s, request=%s", e, JSON.stringify(request))
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
      lapi.Error("Tweed retweet_removed: getUser failed for mid=%s: %s", mid, e)
      throw e
    }
  }
})(request, args)