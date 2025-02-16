((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const FOLLOWERS_LIST = "list_of_followers_mid"
        const followersCount = "followersCount"

        let userId = request["userid"]
        let otherId = request["otherid"]
        let isFollower = request["isfollower"]
        let authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)

        ///////////////////////////////////////
        //  IMPORTANT: bool is passed as string
        ///////////////////////////////////////
        if (isFollower == "true") {
            // otherId is a follower of userId
            lapi.Hset(mmsid, FOLLOWERS_LIST, otherId, Date.now())
            user[followersCount] = user[followersCount]>0 ? user[followersCount]-1 : 0
            console.log(userId, "add follower", otherId)
        } else {
            lapi.Hdel(mmsid, FOLLOWERS_LIST, otherId)
            user[followersCount] += 1
            console.log(userId, "removed follower", otherId)
        }
        lapi.MMBackup(mmsid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)
        return user
    } catch(e) {
        console.error("Error toggle_follower", JSON.stringify(request), e)
    }
})(request, args)