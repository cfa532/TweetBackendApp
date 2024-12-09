((request, args) => {
  try {
    // After use remove a retweet, update the record in the original tweet
    const RETWEET_COUNT = "tweet_retweet_count"
    const RETWEET_LIST = "tweet_retweet_list"

    let tweetId = request["tweetid"]      // original tweetId
    let fansId = request["userid"]        // user who made the retweet

    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, tweetId, "cur")
    let count = lapi.Get(mmsid, RETWEET_COUNT)

    lapi.Hdel(mmsid, RETWEET_LIST, fansId)
    count = count > 0 ? count - 1 : 0
    lapi.Set(mmsid, RETWEET_COUNT, count)
    lapi.MMBackup(authSid, tweetId, "", "delref=true")
    lapi.MiMeiPublish(authSid, "", tweetId)
    
    return lapi.RunMApp("get_tweet", {
      aid: request["aid"], ver: "last",
      userid: fansId, tweetid: tweetId
    }, [])
  } catch (e) {
    console.error("Error toggle_likes", JSON.stringify(request), e)
  }
})(request, args)