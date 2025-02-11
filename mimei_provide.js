((request, args)=>{
    /**
     * Provide the user or tweet to the DHT network.
     */
    try {
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
            lapi.MiMeiSync(authSid, "", tweetId, {})
            let dhtreply = lapi.MiMeiProvide(authSid, "", tweetId)
            console.log("provide tweet", JSON.stringify(dhtreply), tweetId)
        } 
        if (userId) {
            // provide for user
            lapi.MiMeiSync(authSid, "", userId, {})
            let dhtreply = lapi.MiMeiProvide(authSid, "", userId)
            console.log("provide user", JSON.stringify(dhtreply), userId)
        }
    } catch(e) {
        console.error("Error provide", JSON.stringify(request), e)
    }
})(request, args)