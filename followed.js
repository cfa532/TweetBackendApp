(()=>{
    const FANS_COUNT = "user_followers_count"
    const FOLLOWERS_LIST = "list_of_followers_mid"

    let userId = request["userid"]    // current user Id
    let fansId = request["fansid"]    // user Id of the new follower
    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, userId, "cur")

    let count = lapi.Get(mmsid, FANS_COUNT)
    if (lapi.Hget(mmsid, FOLLOWERS_LIST, fansId)) {
        lapi.Hdel(mmsid, FOLLOWERS_LIST, fansId)
        count--
    } 
    else {
        // use timestamp in place of boolean, for sorting if necessary.
        // has to turn it back to boolean returning to app.
        lapi.Hset(mmsid, FOLLOWERS_LIST, fansId, String(Date.now()))
        count++
    }
    lapi.Set(mmsid, FANS_COUNT, count)
    lapi.MMBackup(authSid, userId, "")
    // lapi.MiMeiPublish(authSid, "", tweetId)

    return count
})()