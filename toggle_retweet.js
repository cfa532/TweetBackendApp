(()=>{
    // Update the record of the original tweet, after creating or removing a retweet of it.
    const RETWEET_COUNT = "tweet_retweet_count"
    const RETWEET_LIST = "tweet_retweet_list"

    let retweetId = request["retweetid"]  // the retweed Id created by the follower
    let tweetId = request["tweetid"]      // original tweetId
    let fansId = request["userid"]        // user who made the retweet

    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, tweetId, "cur")
    let count = lapi.Get(mmsid, RETWEET_COUNT)

    let tid = lapi.Hget(mmsid, RETWEET_LIST, fansId)
    if (tid) {
      // the follower has forwarded. Remove it.
      lapi.Hdel(mmsid, RETWEET_LIST, fansId)
      count--
      lapi.Set(mmsid, RETWEET_COUNT, count)
      lapi.MMBackup(authSid, tweetId, "", "delref=true")
      // when the follower received this Id, it will remove it from its own tweet list
      console.log("Remove retweetId=", tweetId, tid, count)

      // Also remove it from user's tweet list
      lapi.RunMApp("delete_tweet", {aid: request["aid"], ver: "last",
        tweetid: tid, authorid: fansId
      })

      return {retweetId: tid, count: count}
    } else {
      lapi.Hset(mmsid, RETWEET_LIST, fansId, retweetId)
      count++
      lapi.Set(mmsid, RETWEET_COUNT, count)
      lapi.MMBackup(authSid, tweetId, "", "delref=true")

      console.log("Add retweetId=", retweetId, count)
      return {retweetId: null, count: count}
    }
})()
