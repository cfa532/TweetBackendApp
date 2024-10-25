((request, args)=>{
    try {
        const FOLLOWINGS_LIST = "list_of_followings_mid"

        let userId = request["userid"]
        let otherId = request["otherid"]     // user to be followed or unfollowed

        let authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        console.log(JSON.stringify(request))
        console.log(JSON.stringify(lapi.GetVar("", "mminfo", userId)))
        console.log(JSON.stringify(lapi.GetVar("", "mminfo", otherId)))
        
        // check if the otherid is being followed by the user
        let isFollowing = lapi.Hget(mmsid, FOLLOWINGS_LIST, otherId)
        if (isFollowing) {
            lapi.Hdel(mmsid, FOLLOWINGS_LIST, otherId)
            // let dhtreply = lapi.MiMeiUnprovide(authSid, "", otherId, false)
            // lapi.MMDelVers(authSid, otherId)
            // console.log("Unfollowing", userId, JSON.stringify(dhtreply))
        } else {
            lapi.Hset(mmsid, FOLLOWINGS_LIST, otherId, Date.now())
            // let dhtreply = lapi.MiMeiProvide(authSid, "", otherId, false)
            // lapi.MiMeiSync(authSid, "", otherId, {})
            // console.log("Add Following", userId, JSON.stringify(dhtreply))
        }
        lapi.MMBackup(mmsid, userId, "", "delref=true")
        mmsid = lapi.MMOpen(authSid, userId, "last")
        
        // return the updated following status on the otherid
        return isFollowing ? false : true
    } catch(e) {
        console.error(e)
        return null
    } 
})(request, args)