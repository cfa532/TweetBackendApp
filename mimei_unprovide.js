((request, args)=>{
    /**
     * If tweetId is passed in, provide for the tweet. Otherwise, provide the user only
     */
    try {
        // nodeId is the writable node of the user, or the base node of the user.
        let userNodeId = request["nodeid"]
        let userId = request["userid"]
        let tweetId = request["tweetid"]
        let authSid = lapi.BELoginAsAuthor()
        let hostId = lapi.GetVar("", "hostid")

        // if current user shares the same node, do nothing.
        if (hostId == userNodeId)
            return
        if (tweetId) {
            // provide for tweet
            let dhtreply = lapi.MiMeiUnprovide(authSid, "", tweetId)
            lapi.MMDelVers(authSid, tweetId)
            console.log("Unprovide tweet", tweetId, JSON.stringify(dhtreply))
        }
        if (userId) {
            // provide for user
            let dhtreply = lapi.MiMeiUnprovide(authSid, "", userId)
            lapi.MMDelVers(authSid, userId)
            console.log("Unprovide user", userId, JSON.stringify(dhtreply))
        }
    } catch(e) {
        console.error("Error unprovide", JSON.stringify(request), e)
    }
})(request, args)