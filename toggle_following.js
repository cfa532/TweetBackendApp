((request, args)=>{
    const FOLLOWINGS_LIST = "list_of_followings_mid"

    let userId = request["userid"]
    let otherId = request["otherid"]     // user to be followed or unfollowed

    let authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, userId, "cur")

    // check if the otherid is being followed by the user
    let f = lapi.Hget(mmsid, FOLLOWINGS_LIST, otherId)
    if (f) {
        lapi.Hdel(mmsid, FOLLOWINGS_LIST, otherId)
        console.log("unfollowing", userId)
    } else {
        lapi.Hset(mmsid, FOLLOWINGS_LIST, otherId, Date.now())
        console.log("following", userId)
    }
    lapi.MMBackup(mmsid, userId, "", "delref=true")
    mmsid = lapi.MMOpen(authSid, userId, "last")
    
    // return the current following status on the otherid
    if (f) {
        return false
    } else {
        return true
    }
})(request, args)