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
        let mmsid = lapi.MMOpen("", msgMid, "cur")

        // the last time user ever sent a message to the receipt.
        let lastTimeFetched = lapi.Zscore(mmsid, READ_MESSAGE, senderId) || 0;
        let tsList = lapi.Zrangebyscore(mmsid, INCOMING_MESSAGE, lastTimeFetched, Date.now(), 0, 10000)
        let messages = tsList.map(e => {
            lapi.Hget(mmsid, senderId, e.member)
        })
        console.log("Incoming from", senderId, JSON.stringify(messages))

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