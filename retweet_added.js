/**
 * Retweet Added Function
 * 
 * This function updates the retweet list in the original tweet after a user
 * retweets it. It handles both local and remote retweet management, ensuring
 * proper tracking of retweets and updating tweet scores.
 * 
 * Key Features:
 * - Adds retweet to original tweet's retweet list
 * - Handles both local and remote retweet management
 * - Updates tweet scores and publishes changes
 * - Returns updated tweet data with retweet information
 * - Manages retweet tracking across distributed nodes
 * 
 * @param {Object} request - The request object containing retweet data
 * @param {string} request.aid - Application ID
 * @param {string} request.retweetid - ID of the retweet created by the follower
 * @param {string} request.tweetid - ID of the original tweet being retweeted
 * @param {string} request.appuserid - ID of user who made the retweet
 * @param {string} request.authorid - ID of the original tweet author
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Updated tweet object with retweet information
 */
((request, args) => {
  // ============================================================================
  // CONSTANTS AND INITIALIZATION
  // ============================================================================
  
  try {
    const RETWEET_LIST = "tweet_retweet_list"  // Redis key for tweet's retweet list
    const APP_ID = request["aid"]  // Application identifier
    const retweetId = request["retweetid"]  // ID of the retweet created by the follower
    const tweetId = request["tweetid"]  // ID of the original tweet being retweeted
    const appUserId = request["appuserid"]  // ID of user who made the retweet
    const authorId = request["authorid"]  // ID of the original tweet author
    const author = getUser(authorId)  // Get author data to determine hosting node
    const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    
    if (!author || !author.hostIds || author.hostIds.length === 0) {
        lapi.Error("Tweed retweet_added: missing host for author %s", JSON.stringify({authorId, nodeId, author}))
        throw new Error("Author not found or missing host")
    }
    
    // ========================================================================
    // REMOTE AUTHOR HANDLING
    // ========================================================================
    
    if (author.hostIds[0] !== nodeId) {
        // Delegate retweet addition to the node hosting the author
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        let ret
        try {
            ret = lapi.RunMApp("retweet_added", {aid: APP_ID, ver: "last",
              nid: author.hostIds[0], sid: systemSid,
              authorid: authorId, tweetid: tweetId, appuserid: appUserId, retweetid: retweetId},
              [])
        } catch(e) {
            lapi.Error("Tweed retweet_added: Failed to call retweet_added on remote node %s: %s, authorId=%s, tweetId=%s", author.hostIds[0], e, authorId, tweetId)
            throw e
        }
        return ret
    } else {
      // ====================================================================
      // LOCAL AUTHOR HANDLING
      // ====================================================================
      const authSid = lapi.BELoginAsAuthor()
      const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")  // Open original tweet for editing
  
      // ================================================================
      // RETWEET LIST UPDATE
      // ================================================================
      
      // Use retweetId as index because one user can retweet many times
      lapi.Hset(tweetSid, RETWEET_LIST, retweetId, appUserId)
      
      // Update tweet data and publish changes
      lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
      lapi.MiMeiPublish(tweetSid, "", tweetId)
  
      // ================================================================
      // SCORE UPDATE AND TWEET RETRIEVAL
      // ================================================================
      
      // Update the score of the original tweet in AppData
      lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
        userid: authorId, mid: tweetId}, [])
  
      // Retrieve the original tweet after updating it
      return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
        appuserid: appUserId, tweetid: tweetId}, [])
    }
  } catch (e) {
    // ========================================================================
    // ERROR HANDLING
    // ========================================================================
    
    lapi.Error("Tweed Error retweet_added: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
    return null
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
      lapi.Error("Tweed retweet_added: getUser failed for mid=%s: %s", mid, e)
      throw e
    }
  }
})(request, args)
