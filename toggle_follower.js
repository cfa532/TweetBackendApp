((request, args)=>{
    try {
        const FOLLOWERS_LIST = "list_of_followers_mid"

        let userId = request["userid"]
        let otherId = request["otherid"]    // the follower whose status is toggled
        let isFollower = request["isfollower"]
        let authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")

        /////////////////////////////////////////////////////////////
        //  IMPORTANT: bool is passed as string "true/false"
        /////////////////////////////////////////////////////////////
        if (isFollower == "true") {
            // otherId is a follower of userId
            lapi.Hset(mmsid, FOLLOWERS_LIST, otherId, Date.now())
        } else {
            // otherId is NOT a follower of userId
            lapi.Hdel(mmsid, FOLLOWERS_LIST, otherId)
        }
        lapi.MMBackup(mmsid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)

        // update the score of the user in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: userId}, [])

    } catch(e) {
        console.error("Error toggle_follower", JSON.stringify(request), e)
    }
})(request, args)