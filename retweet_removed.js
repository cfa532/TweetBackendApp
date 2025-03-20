((request, args) => {
  /**
   * After removing a retweet, update the record in its original tweet.
   */
  try {
    const RETWEET_LIST = "tweet_retweet_list"
    const APP_ID = request["aid"]
    const tweetId = request["tweetid"]      // original tweetId
    const authorId = request["authorid"]        // original tweet author
    const user = getUser(authorId)
    const retweetId = request["retweetid"]    // retweet Id, removed here.

    const nodeId = lapi.GetVar("", "hostid")
    if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        let ret = lapi.RunMApp("retweet_removed", {aid: APP_ID, ver: "last",
            nid: user.hostIds[0], sid: systemSid,
            tweetid: tweetId, authorid: authorId, retweetid: retweetId}, []
        )
        return ret
    } else {
      const authSid = lapi.BELoginAsAuthor()
      const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
      lapi.Hdel(tweetSid, RETWEET_LIST, retweetId)
      lapi.MMBackup(authSid, tweetId, "", "delref=true")
      lapi.MiMeiPublish(authSid, "", tweetId)
  
      // update the score of the original tweet in AppData
      lapi.RunMApp("node_update_score", { aid: request["aid"], ver: "last",
        userid: authorId, mid: tweetId}, []
      )
      return lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
        userid: authorId, tweetid: tweetId}, []
      )
    }
  } catch (e) {
    console.error("Error retweet_removed", JSON.stringify(request), e)
  }

  function getUser(mid) {
    const OWNER_DATA_KEY = "data_of_author"
    const mmsid = lapi.MMOpen("", mid, "last")
    return lapi.Get(mmsid, OWNER_DATA_KEY)
  }
})(request, args)