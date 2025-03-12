/**
 * Keep messags send by other users in receiver's mimei.
 */
((request, args) => {
    const INCOMING_MESSAGE = "incoming_message_indicator"
    const MESSAGE_MIMEI = "message_mimei_1"
    const APP_EXT = "com.example.twitterclone"
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const senderId = request["senderid"]
    const userId = request["receiptid"]       // owner of the data Mimei
    const msg = JSON.parse(request["msg"])

    try {
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            lapi.RunMApp("message_incoming", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                receiptid: userId, senderid: senderId}, []
            )
        } else {
            // create a Mimei for all messages, incoming and outgoing.
            const authSid = lapi.BELoginAsAuthor()
            const msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
            const msgSid = lapi.MMOpen(authSid, msgMid, "cur")

            // Always keep the most recent message in the imcoming message index
            lapi.Hset(msgSid, INCOMING_MESSAGE, senderId, msg)
            console.log("Incoming message", request["msg"], msgMid)

            // use a Zset as message index for fast query, and hset to store message.
            // senderId is the key for both.
            sp = new ScorePair
            sp.Score = msg.timestamp
            sp.Member = String(msg.timestamp)
            lapi.Zadd(msgSid, senderId, sp)
            lapi.Hset(msgSid, senderId, sp.Member, msg)
            lapi.MMBackup(authSid, msgMid, "", "delref=true")
        }
    } catch(e) {
        console.error("Error message_incoming", JSON.stringify(request), e)
    }

    function ScorePair() {}

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)