(()=>{
    const BOOKMARK_COUNT = "tweet_bookmark_count"
    const BOOKMARK_LIST = "tweet_bookmark_list"

    let userId = request["userid"]    // user id
    let tweetId = request["tweetid"]

    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, tweetId, "cur")

    let count = lapi.Get(mmsid, BOOKMARK_COUNT)
    count = count ? count : 0

    let hasMarked = lapi.Hget(mmsid, BOOKMARK_LIST, userId) ? true : false
    if (hasMarked) {
        lapi.Hdel(mmsid, BOOKMARK_LIST, userId)
        count -= 1
    } 
    else {
        lapi.Hset(mmsid, BOOKMARK_LIST, userId, Date.now())
        count += 1
    }
    lapi.Set(mmsid, BOOKMARK_COUNT, count)
    lapi.MMBackup(authSid, tweetId, "")
    // lapi.MiMeiPublish(authSid, "", tweetId)

     return {hasBookmarked: hasMarked?false:true, count: count}
})()