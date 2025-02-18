((request, args)=>{
    try {
        const FOLLOWINGS_LIST = "list_of_followings_mid"

        let userId = request["userid"]
        let otherId = request["otherid"]     // userId to follow or unfollow
        let authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")

        // check if the otherid is in the following list of the user
        let isFollowing = lapi.Hget(mmsid, FOLLOWINGS_LIST, otherId)
        if (isFollowing) {
            lapi.Hdel(mmsid, FOLLOWINGS_LIST, otherId)
            console.log(userId, "unfollows", otherId)
        } else {
            lapi.Hset(mmsid, FOLLOWINGS_LIST, otherId, Date.now())
            console.log(userId, "follows", otherId)
        }
        lapi.MMBackup(mmsid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)
        
        // return the updated following status on the otherid,
        return isFollowing ? false : true

    } catch(e) {
        console.error("Error toggle_followings", JSON.stringify(request), e)
        return null
    } 
})(request, args)