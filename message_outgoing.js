/**
 * MESSAGE OUTGOING - Sender's Message Storage
 * 
 * This file handles storing outgoing messages in the sender's own node.
 * When a user sends a message, it gets stored in their local message Mimei
 * under the recipient's ID as the key. This creates a local copy of all
 * messages sent by this user.
 * 
 * Algorithm Flow:
 * 1. Sender creates a message
 * 2. Message is stored in sender's local Mimei under recipient's ID
 * 3. Message is also sent to recipient's node via message_incoming.js
 * 
 * Data Structure:
 * - Uses Zset (sorted set) with recipient ID as key for message indexing
 * - Uses Hset (hash set) to store actual message content
 * - Timestamp is used as both score and member for chronological ordering
 */
((request, args) => {
    const MESSAGE_MIMEI = "message_mimei_1"
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "us.fireshare.tweet"
    const receiptId = request["receiptid"]  // ID of the message recipient
    const senderId = request["userid"]        // ID of the message sender
    const msg = JSON.parse(request["msg"])  // Parsed message object with timestamp

    try {        
        const user = getUser(senderId)
        const nodeId = lapi.GetVar("", "hostid")
        
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed message_outgoing: missing host for user %s", JSON.stringify({senderId, nodeId, user}))
            return false
        }

        // If user's primary node is not the current node, forward to primary node
        if (user.hostIds[0] !== nodeId) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret
            try {
                ret = lapi.RunMApp("message_outgoing", {aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    userid: senderId, receiptid: receiptId, msg: request["msg"]}, []
                )
            } catch(e) {
                lapi.Error("Tweed message_outgoing: Failed to call message_outgoing on remote node %s: %s, senderId=%s, receiptId=%s", user.hostIds[0], e, senderId, receiptId)
                throw e
            }
            return ret
        } else {
            // Store outgoing message in sender's local Mimei
            const authSid = lapi.BELoginAsAuthor()
            const msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, senderId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
            const msgSid = lapi.MMOpen(authSid, msgMid, "cur")
            lapi.Debug("Tweed message_outgoing: %s outgoing message to %s, msg=%s, msgMid=%s", senderId, receiptId, request["msg"], msgMid)

            // Create score pair for Zset indexing
            const sp = new ScorePair()
            sp.Score = Date.now()  // Use timestamp as score for chronological ordering
            sp.Member = String(sp.Score)  // Use timestamp as member for unique identification

            // Store message in sender's local database:
            // 1. Add to Zset for fast chronological querying by recipient
            // 2. Store actual message content in Hset
            lapi.Zadd(msgSid, receiptId, sp)
            lapi.Hset(msgSid, receiptId, sp.Member, msg)
            lapi.MMBackup(msgSid, msgMid, "", "delref=true")
            return true
        }
    } catch(e) {
        lapi.Error("Tweed Error message_outgoing: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
    }

    function ScorePair() {}

    function getUser(mid) {
        try {
            const OWNER_DATA_KEY = "data_of_author"
            const mmsid = lapi.MMOpen("", mid, "last")
            return lapi.Get(mmsid, OWNER_DATA_KEY)
        } catch(e) {
            lapi.Error("Tweed message_outgoing: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)