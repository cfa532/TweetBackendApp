/**
 * Put outgoing message in sender's mimei
 */
((request, args) => {
    const MESSAGE_MIMEI = "message_mimei_1"
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"

    try {
        const receiptId = request["receiptid"]
        const userId = request["userid"]
        const msg = JSON.parse(request["msg"])
        
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            lapi.RunMApp("message_outgoing", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId, receiptid: receiptId, msg: request["msg"]}, []
            )
        } else {
            // create a message Mimei for all messages, incoming and outgoing.
            const authSid = lapi.BELoginAsAuthor()
            const msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
            const msgSid = lapi.MMOpen(authSid, msgMid, "cur")
            console.log("outgoing message", request["msg"], msgMid)

            sp = new ScorePair
            sp.Score = msg.timestamp
            sp.Member = String(msg.timestamp)

            // use a zset as message index and hset to store message.
            // receiptId is the key for both.
            lapi.Zadd(msgSid, receiptId, sp)
            lapi.Hset(msgSid, receiptId, sp.Member, msg)
            lapi.MMBackup(msgSid, msgMid, "", "delref=true")
        }
    } catch(e) {
        console.error("Error message_outgoing", JSON.stringify(request), e)
    }

    function ScorePair() {}

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)