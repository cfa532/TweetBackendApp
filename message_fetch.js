((request, args)=>{
    try {
        // fetch new messages from a sender.

        const READ_MESSAGE = "read_message_indicator"   // hset of the last time a user message is read.
        const MESSAGE_MIMEI = "message_mimei_1"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"

        let authSid = lapi.BELoginAsAuthor()
        let userId = request["userid"]
        let senderId = request["senderid"]

        // get Mid of message Mimei
        let msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
        let mmsid = lapi.MMOpen(authSid, msgMid, "last")
        
        // the last time user fetch message from the sender
        let lastTimeFetched = 0
        lapi.Zrange(mmsid, READ_MESSAGE, 0, -1).map(sp => {
            if (sp.Member == senderId) {
                lastTimeFetched = sp.Score
            }
        })
        // let nowTime = lastTimeFetched + 31104000000
        let nowTime = Date.now()
        let tsList = lapi.Zrangebyscore(mmsid, senderId, lastTimeFetched, nowTime, 0, 10000)
        let messages = tsList.map(e => {
            // message from both parties are here, but read only msg from the other.
            if (e.Member == senderId)
                return lapi.Hget(mmsid, senderId, e.Member)   // MUST have a return, other wise null is returned.
        }).filter(e => e)
        console.log("Fetch incoming from", senderId, JSON.stringify(messages))

        // update message reading indicator
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = Date.now()
        sp.Member = senderId
        mmsid = lapi.MMOpen(authSid, msgMid, "cur")
        lapi.Zadd(mmsid, READ_MESSAGE, sp)  // if memeber exists, score will be updated, otherwise insert.
        lapi.MMBackup(authSid, msgMid, "", "delref=true")
        return messages
    } catch(e) {
        console.error(e)
    }
})(request, args)