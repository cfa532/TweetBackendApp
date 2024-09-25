((request, args) => {
    try {
        // get messags send by other users.
        const INCOMING_MESSAGE = "incoming_message_indicator"
        const MESSAGE_MIMEI = "message_mimei_1"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"

        let senderId = request["senderid"]
        let userId = request["receiptid"]       // owner of the data Mimei
        let authSid = lapi.BELoginAsAuthor()

        // create a Mimei for all messages, incoming and outgoing.
        let msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
        let mmsid = lapi.MMOpen(authSid, msgMid, "cur")
        let msg = JSON.parse(request["msg"])
        console.log("Incoming message", msgMid, request["msg"])
        // Always keep the most recent message in the Hset
        lapi.Hset(mmsid, INCOMING_MESSAGE, senderId, msg)

        // use a Zset as message index for fast query, and hset to store message.
        // senderId is the key for both.
        sp = new ScorePair
        sp.Score = msg.timestamp
        sp.Member = String(msg.timestamp)
        lapi.Zadd(mmsid, senderId, sp)
        lapi.Hset(mmsid, senderId, sp.Member, msg)
        // lapi.MMBackup(authSid, msgMid, "", "delref=true")

    } catch(e) {
        console.error(e)
    }

    function ScorePair() {}

})(request, args)