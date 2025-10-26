/**
 * MESSAGE INCOMING - Receiver's Message Storage
 * 
 * This file handles storing incoming messages in the receiver's node.
 * When a message is sent to a user, it gets stored in their local message Mimei
 * under the sender's ID as the key. This creates a local copy of all
 * messages received by this user.
 * 
 * Algorithm Flow:
 * 1. Message arrives from sender's node
 * 2. Message is stored in receiver's local Mimei under sender's ID
 * 3. Message is added to incoming message indicator for notification purposes
 * 4. Message remains unread until user explicitly fetches it via message_fetch.js
 * 
 * Data Structure:
 * - INCOMING_MESSAGE: Hset that tracks the most recent message from each sender
 * - Uses Zset (sorted set) with sender ID as key for message indexing
 * - Uses Hset (hash set) to store actual message content
 * - Timestamp is used as both score and member for chronological ordering
 */
((request, args) => {
    const LAST_INCOMING_MSG = "incoming_message_indicator"  // Tracks most recent unread message from each sender
    const MESSAGE_MIMEI = "message_mimei_1"
    const APP_EXT = "us.fireshare.tweet"
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const senderId = request["senderid"]     // ID of the message sender
    const receiptId = request["receiptid"]      // ID of the message receiver (owner of the data Mimei)
    const msg = JSON.parse(request["msg"])   // Parsed message object with timestamp

    try {
        const user = getUser(receiptId)
        const nodeId = lapi.GetVar("", "hostid")
        
        // If user's primary node is not the current node, forward to primary node
        if (user.hostIds.findIndex(id => id === nodeId) !== 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            return lapi.RunMApp("message_incoming", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                receiptid: receiptId, senderid: senderId, msg: request["msg"]}, []
            )
        } else {
            // Store incoming message in receiver's local Mimei
            const authSid = lapi.BELoginAsAuthor()
            const msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, receiptId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
            const msgSid = lapi.MMOpen(authSid, msgMid, "cur")

            /**
             * The client's time might be different from the server's time.
             * So we need to store the timestamp of the server as the indicator,
             * and use it the find the last message from a sender.
             */
            const sp = new ScorePair()
            sp.Score = Date.now()  // Use current time as score (must be integer for Zset)
            sp.Member = String(sp.Score)  // Use timestamp as member for unique identification

            // Update the incoming_message indicator with the last message from a sender
            // Used by message_check.js to determine if there are new unread messages
            lapi.Hset(msgSid, LAST_INCOMING_MSG, senderId, sp.Member)
            lapi.Debug("message_incoming:", senderId, "to", receiptId, request["msg"])

            // Store message in receiver's local database:
            // 1. Add to Zset for fast chronological querying by sender
            // 2. Store actual message content in Hset
            lapi.Zadd(msgSid, senderId, sp)
            lapi.Hset(msgSid, senderId, sp.Member, msg)
            lapi.MMBackup(authSid, msgMid, "", "delref=true")
            return {success: true}
        }
    } catch(e) {
        lapi.Error("Error message_incoming", JSON.stringify(request), e)
        return {success: false, error: e.message}
    }

    function ScorePair() {}

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)