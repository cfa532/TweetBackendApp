(()=>{
    const FOLLOWINGS_COUNT = "user_followings_count"
    const FOLLOWINGS_LIST = "list_of_followings_mid"

    let userId = request["userid"]    // current user Id
    let idToFollow = request["followingId"]  // Id to be followed. 
    var authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, userId, "cur")

    let count = lapi.Get(mmsid, FOLLOWINGS_COUNT)
    if (lapi.Hget(mmsid, FOLLOWINGS_LIST, idToFollow)) {
        lapi.Hdel(mmsid, FOLLOWINGS_LIST, idToFollow)
        count--
    } 
    else {
        // use timestamp in place of boolean, for sorting if necessary.
        // has to turn it back to boolean returning to app.
        lapi.Hset(mmsid, FOLLOWINGS_LIST, idToFollow, String(Date.now()))
        count++
    }
    lapi.Set(mmsid, FOLLOWINGS_COUNT, count)
    lapi.MMBackup(authSid, userId, "")
    // lapi.MiMeiPublish(authSid, "", tweetId)

    return count
})()