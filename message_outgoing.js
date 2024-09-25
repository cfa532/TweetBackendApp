((request, args) => {
    try {
        const MESSAGE_MIMEI = "message_mimei_1"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"

        let receiptId = request["receiptid"]
        let userId = request["userid"]

        let authSid = lapi.BELoginAsAuthor()

        // create a Mimei for all messages, incoming and outgoing.
        let msg = JSON.parse(request["msg"])
        let msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
        let mmsid = lapi.MMOpen(authSid, msgMid, "cur")
        console.log("outgoing message", request["msg"], msgMid)

        function ScorePair() {}
        sp = new ScorePair
        sp.Score = msg.timestamp
        sp.Member = String(msg.timestamp)

        // use a zset as message index and hset to store message.
        // senderId is the key for both.
        lapi.Zadd(mmsid, receiptId, sp)
        lapi.Hset(mmsid, receiptId, sp.Member, msg)
        // lapi.MMBackup(authSid, msgMid, "", "delref=true")

    } catch(e) {
        console.error(e)
    }
})(request, args)