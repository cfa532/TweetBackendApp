((request, args) => {
  try {
    // Update the record of the original tweet, after retweeting it.
    const RETWEET_LIST = "tweet_retweet_list"

    let retweetId = request["retweetid"]  // the retweed Id created by the follower
    let tweetId = request["tweetid"]      // original tweetId
    let fansId = request["userid"]        // user who made the retweet
    let authorId = request["authorid"]    // author of the original tweet

    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, tweetId, "cur")

    // use retweetId as index because one user can retweet many times.
    lapi.Hset(mmsid, RETWEET_LIST, retweetId, fansId)
    lapi.MMBackup(authSid, tweetId, "", "delref=true")
    lapi.MiMeiPublish(authSid, "", tweetId)
    lapi.MiMeiPublish(authSid, "", authorId)

    // update the score of the original tweet in AppData
    lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
      userid: authorId, mid: tweetId}, [])

    // retrieve the original tweet after updating it.
    return lapi.RunMApp("get_tweet", {aid: request["aid"], ver:"last",
      userid: fansId, tweetid: tweetId}, [])
  } catch (e) {
    console.error("Error retweet_add", JSON.stringify(request), e)
  }
})(request, args)
