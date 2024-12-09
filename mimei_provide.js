((request, args)=>{
    /**
     * If tweetId is passed in, provide for the tweet. Otherwise, provide the user only
     */
    try {
        let userId = request["userid"]
        let tweetId = request["tweetid"]
        let authSid = lapi.BELoginAsAuthor()
        if (tweetId) {
            // provide for tweet
            lapi.MiMeiSync(authSid, "", tweetId, [])
            let dhtreply = lapi.MiMeiProvide(authSid, "", tweetId)
            console.log("provide tweet", JSON.stringify(dhtreply), tweetId)
        } else {
            // provide for user
            lapi.MiMeiSync(authSid, "", userId, [])
            let dhtreply = lapi.MiMeiProvide(authSid, "", userId)
            console.log("provide user", JSON.stringify(dhtreply), userId)
        }
    } catch(e) {
        console.error("Error provide", JSON.stringify(request), e)
    }
})(request, args)