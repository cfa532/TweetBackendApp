((request, args)=>{
    /**
     * Provide the user or tweet to the DHT network.
     */
    try {
        let targetId = request["mid"]
        let isProvider = request["provide"]
        let authSid = lapi.BELoginAsAuthor()

        if (isProvider === "true") {
            lapi.MiMeiSync(authSid, "", targetId, {})
            let dhtreply = lapi.MiMeiProvide(authSid, "", targetId)
            console.log("provide", targetId, JSON.stringify(dhtreply))
        } else {
            let dhtreply = lapi.MiMeiUnprovide(authSid, "", targetId)
            lapi.MMDelVers(authSid, targetId)
            console.log("Unprovide", targetId, JSON.stringify(dhtreply))
        }
    } catch(e) {
        console.error("Error provide", JSON.stringify(request), e)
    }
})(request, args)