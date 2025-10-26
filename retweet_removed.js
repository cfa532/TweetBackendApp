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
  
  try {
    const RETWEET_LIST = "tweet_retweet_list"  // Redis key for tweet's retweet list
    const APP_ID = request["aid"]  // Application identifier
    const tweetId = request["tweetid"]  // ID of the original tweet being unretweeted
    const authorId = request["authorid"]  // ID of the original tweet author
    const user = getUser(authorId)  // Get author data to determine hosting node
    const retweetId = request["retweetid"]  // ID of the retweet being removed
    const appUserId = request["appuserid"]  // ID of user removing the retweet

    const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    
    // ========================================================================
    // REMOTE AUTHOR HANDLING
    // ========================================================================
    
    if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
        // Delegate retweet removal to the node hosting the author
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        let ret = lapi.RunMApp("retweet_removed", {aid: APP_ID, ver: "last",
            nid: user.hostIds[0], sid: systemSid, appuserid: appUserId,
            tweetid: tweetId, authorid: authorId, retweetid: retweetId},
            [])
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
      
      // Remove retweet from the original tweet's retweet list
      lapi.Hdel(tweetSid, RETWEET_LIST, retweetId)
      
      // Update tweet data and publish changes
      lapi.MMBackup(authSid, tweetId, "", "delref=true")
      lapi.MiMeiPublish(authSid, "", tweetId)
  
      // ================================================================
      // SCORE UPDATE AND TWEET RETRIEVAL
      // ================================================================
      
      // Update the score of the original tweet in AppData
      lapi.RunMApp("node_update_score", { aid: request["aid"], ver: "last",
        userid: authorId, mid: tweetId}, []
      )
      
      // Retrieve the original tweet after updating it
      return lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
        appuserid: appUserId, tweetid: tweetId}, []
      )
    }
  } catch (e) {
    // ========================================================================
    // ERROR HANDLING
    // ========================================================================
    
    lapi.Error("Error retweet_removed", JSON.stringify(request), e)
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