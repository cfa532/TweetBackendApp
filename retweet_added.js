/**
 * Update the record of the original tweet, after retweeting it.
 */

((request, args) => {
  try {
    const RETWEET_LIST = "tweet_retweet_list"
    const APP_ID = request["aid"]

    const retweetId = request["retweetid"]  // the retweed Id created by the follower
    const tweetId = request["tweetid"]      // original tweetId
    const fansId = request["userid"]        // user who made the retweet
    const authorId = request["authorid"]    // author of the original tweet
    const author = getUser(authorId)

    const nodeId = lapi.GetVar("", "hostid")
    if (author.hostIds?.findIndex(id => id == nodeId) != 0) {
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        let ret = lapi.RunMApp("retweet_removed", {aid: APP_ID, ver: "last",
          nid: author.hostIds[0], sid: systemSid, authorid: authorId,
          tweetid: tweetId, userid: userId, retweetid: retweetId
        }, [])
        return ret
    } else {
      const authSid = lapi.BELoginAsAuthor()
      const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
  
      // use retweetId as index because one user can retweet many times.
      lapi.Hset(tweetSid, RETWEET_LIST, retweetId, fansId)
      lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
      lapi.MiMeiPublish(tweetSid, "", tweetId)
  
      // update the score of the original tweet in AppData
      lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
        userid: authorId, mid: tweetId}, [])
  
      // retrieve the original tweet after updating it.
      return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
        userid: fansId, tweetid: tweetId}, [])
    }
  } catch (e) {
    console.error("Error retweet_add", JSON.stringify(request), e)
  }

  function getUser(mid) {
    const OWNER_DATA_KEY = "data_of_author"
    const mmsid = lapi.MMOpen("", mid, "last")
    return lapi.Get(mmsid, OWNER_DATA_KEY)
  }
})(request, args)
