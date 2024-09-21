(()=>{
    const FOLLOWERS_LIST = "list_of_followers_mid"

    let userId = request["userid"]
    let otherId = request["otherid"]     // user to be followed or unfollowed

    let authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, userId, "cur")

    // check if the otherid is following the user
    let f = lapi.Hget(mmsid, FOLLOWERS_LIST, otherId)
    if (f) {
        lapi.Hdel(mmsid, FOLLOWERS_LIST, otherId)
    } else {
        lapi.Hset(mmsid, FOLLOWERS_LIST, otherId, Date.now())
    }
    lapi.MMBackup(mmsid, userId, "", "delref=true")
    mmsid = lapi.MMOpen(authSid, userId, "last")

    // return if the other is follower or not
    if (f) {
        return false
    } else {
        return true
    }
})()