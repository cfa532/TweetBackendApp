(()=>{
    try {
        const FOLLOWERS_LIST = "list_of_followers_mid"

        let userId = request["userid"]
        let otherId = request["otherid"]     // user to be followed or unfollowed
        let ifFollower = request["isfollower"]
        let authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")

        if (ifFollower) {
            // otherId is a follower of userId
            lapi.Hset(mmsid, FOLLOWERS_LIST, otherId, Date.now())
            console.log("followed by", userId)
        } else {
            lapi.Hdel(mmsid, FOLLOWERS_LIST, otherId)
            console.log("unfollowed by", userId)
        }
        lapi.MMBackup(mmsid, userId, "", "delref=true")
    } catch(e) {
        console.error(e)
    }
})()