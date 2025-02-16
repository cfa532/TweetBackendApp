((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const FOLLOWINGS_LIST = "list_of_followings_mid"
        const followingCount = "followingCount"

        let userId = request["userid"]
        let otherId = request["otherid"]     // user to follow or unfollow

        let authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)

        // check if the otherid is in the following list of the user
        let isFollowing = lapi.Hget(mmsid, FOLLOWINGS_LIST, otherId)
        if (isFollowing) {
            lapi.Hdel(mmsid, FOLLOWINGS_LIST, otherId)
            user[followingCount] = user[followingCount]>0 ? user[followingCount]-1 : 0
            console.log(userId, "unfollows", otherId)
        } else {
            lapi.Hset(mmsid, FOLLOWINGS_LIST, otherId, Date.now())
            user[followingCount] += 1
            console.log(userId, "follows", otherId)
        }
        lapi.MMBackup(mmsid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)
        
        // return the updated following status on the otherid
        return isFollowing ? false : true
    } catch(e) {
        console.error("Error toggle_followings", JSON.stringify(request), e)
        return null
    } 
})(request, args)