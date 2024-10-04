(()=>{
    const LIKE_COUNT = "tweet_like_count"
    const LIKE_LIST = "tweet_like_list"

    let userId = request["userid"]    // tweet id
    let tweetId = request["tweetid"]

    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, tweetId, "cur")

    let count = lapi.Get(mmsid, LIKE_COUNT)
    count = count ? count : 0
    let hasLiked = lapi.Hget(mmsid, LIKE_LIST, userId) ? true : false
    if (hasLiked) {
        lapi.Hdel(mmsid, LIKE_LIST, userId)
        count -= 1
    } 
    else {
        // use timestamp in place of boolean, for sorting if necessary.
        // has to turn it back to boolean returning to app.
        lapi.Hset(mmsid, LIKE_LIST, userId, Date.now())
        count += 1
    }
    lapi.Set(mmsid, LIKE_COUNT, count)
    lapi.MMBackup(authSid, tweetId, "", "delref=true")
    // lapi.MiMeiPublish(authSid, "", tweetId)

    console.log("liked=", !hasLiked, count)
    return {hasLiked: hasLiked ? false:true, count: count}
})()