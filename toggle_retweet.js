(()=>{
    // update retweet records within the tweet that is forwarded.
    const RETWEET_COUNT = "tweet_retweet_count"
    const RETWEET_LIST = "tweet_retweet_list"

    let retweetId = request["retweetid"]  // the retweed Id created by the follower
    let tweetId = request["tweetid"]      // the tweet being forwarded
    let fansId = request["userid"]        // user who made the retweet

    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, tweetId, "cur")
    let count = lapi.Get(mmsid, RETWEET_COUNT)

    tid = lapi.Hget(mmsid, RETWEET_LIST, fansId)  // the follower has forwarded. Remove it.
    if (tid) {
      lapi.Hdel(mmsid, RETWEET_LIST, fansId)
      count--
      lapi.Set(mmsid, RETWEET_COUNT, count)
      lapi.MMBackup(authSid, tweetId, "")
      // when the follower received this Id, it will remove it from its own tweet list
      return {retweetId: tid, count: count}
    } else {
      lapi.Hset(mmsid, RETWEET_LIST, fansId, retweetId)
      count++
      lapi.Set(mmsid, RETWEET_COUNT, count)
      lapi.MMBackup(authSid, tweetId, "")
      return {retweetId: null, count: count}
    }
})()
