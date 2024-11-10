((request, args)=>{
    try {
        const FOLLOWERS_LIST = "list_of_followers_mid"

        let userId = request["userid"]
        let otherId = request["otherid"]
        let isFollower = request["isfollower"]
        let authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")

        // IMPORTANT: bool is passed as string
        if (isFollower == "true") {
            // otherId is a follower of userId
            lapi.Hset(mmsid, FOLLOWERS_LIST, otherId, Date.now())
            console.log(userId, "add follower", otherId)
        } else {
            lapi.Hdel(mmsid, FOLLOWERS_LIST, otherId)
            console.log(userId, "removed follower", otherId)
        }
        lapi.MMBackup(mmsid, userId, "", "delref=true")
    } catch(e) {
        console.error("Error toggle_follower", JSON.stringify(request), e)
    }
})(request, args)