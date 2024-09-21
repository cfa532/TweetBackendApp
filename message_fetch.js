((request, args)=>{
    try {
        // fetch new messages from a sender.

        const READ_MESSAGE = "read_message_indicator"   // hset of the last time a user message is read.
        const INCOMING_MESSAGE = "incoming_message_indicator"
        const MESSAGE_MIMEI = "message_mimei"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"

        let authSid = lapi.BELoginAsAuthor()
        let userId = request["userid"]
        let senderId = request["senderid"]

        // get Mid of message Mimei
        let msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
        let mmsid = lapi.MMOpen(authSid, msgMid, "cur")
        
        // the last time user fetch message from the sender
        let lastTimeFetched = 0
        lapi.Zrange(mmsid, READ_MESSAGE, 0, -1).map(sp => {
            if (sp.member == senderId) {
                lastTimeFetched = sp.score
            }
        })
        console.log("Fetch message MimeiId", msgMid, lastTimeFetched, senderId)
        
        let tsList = lapi.Zrangebyscore(mmsid, INCOMING_MESSAGE, lastTimeFetched, Date.now(), 0, 10000)
        let messages = tsList.map(e => {
            lapi.Hget(mmsid, senderId, e.member)
        })
        console.log("Fetch incoming from", senderId, JSON.stringify(messages))

        // update message reading indicator
        function ScorePair() {}
        sp = new ScorePair
        sp.score = Date.now()
        sp.member = senderId
        lapi.Zadd(mmsid, READ_MESSAGE, sp)  // if memeber exists, update the score.
        lapi.MMBackup(authSid, msgMid, "", "delref=true")
        return messages
    } catch(e) {
        console.error(e)
    }
})(request, args)