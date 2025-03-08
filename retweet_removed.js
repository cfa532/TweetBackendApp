((request, args) => {
  try {
    // After removing a retweet, update the record in its original tweet
    const RETWEET_LIST = "tweet_retweet_list"

    let tweetId = request["tweetid"]      // original tweetId
    let userId = request["userid"]        // original tweet author
    let retweetId = request["retweetid"]    // retweet Id, removed here.
    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, tweetId, "cur")

    lapi.Hdel(mmsid, RETWEET_LIST, retweetId)
    lapi.MMBackup(authSid, tweetId, "", "delref=true")
    lapi.MiMeiPublish(authSid, "", tweetId)
    lapi.MiMeiPublish(authSid, "", userId)

    // update the score of the original tweet in AppData
    lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
      userid: userId, mid: tweetId}, [])
    
    return lapi.RunMApp("get_tweet", {aid: request["aid"], ver: "last",
      userid: userId, tweetid: tweetId}, [])
  } catch (e) {
    console.error("Error toggle_likes", JSON.stringify(request), e)
  }
})(request, args)