/**
 * MESSAGE CHECK - Periodic Unread Message Detection
 * 
 * This file handles checking for new unread messages periodically.
 * It compares the timestamp of the most recent message from each sender
 * against the last time the user fetched messages from that sender.
 * 
 * Algorithm Flow:
 * 1. Get all senders who have sent messages to this user
 * 2. For each sender, compare their most recent message timestamp
 *    against the last fetch timestamp for that sender
 * 3. If the message is newer than the last fetch, include it in results
 * 4. Return list of unread messages for notification purposes
 * 
 * Key Points:
 * - This only DETECTS unread messages, it doesn't mark them as read
 * - Messages are only marked as read when user explicitly fetches them via message_fetch
 * - Uses INCOMING_MESSAGE to track most recent message from each sender
 * - Uses LAST_FETCH_MSG to track last fetch time for each sender
 */
((request, args)=>{
    const LAST_FETCH_MSG = "read_message_indicator"   // Zset tracking the last time a user fetched messages from each sender
    const LAST_INCOMING_MSG = "incoming_message_indicator"   // Hset tracking the most recent message received from each sender
    const APP_ID = request["aid"]
    const APP_EXT = "us.fireshare.tweet"
    const MESSAGE_MIMEI = "message_mimei_1"
    const userId = request["userid"]

    try {
        // Get authentication and create/open message Mimei
        const authSid = lapi.BELoginAsAuthor()
        const msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
        const msgSid = lapi.MMOpen("", msgMid, "last")
        
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")
        
        // If user's primary node is not the current node, forward to primary node
        if (user.hostIds.findIndex(id => id === nodeId) !== 0) {
            console.log("message_check: Forwarding to primary node", user.hostIds[0])
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("message_check", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId}, []
            )
            return ret
        } else {
            // Get all senders who have sent messages to this user
            const senders = lapi.Hkeys(msgSid, LAST_INCOMING_MSG)
            let lastTimeFetched = 0;

            // Check each sender for new unread messages
            const messageList = senders.map(senderId => {
                /**
                 * Check if the app has ever fetched messages from this sender
                 */
                const rank = lapi.Zrank(msgSid, LAST_FETCH_MSG, senderId)
                if (rank > -1) {
                    // get the last time the app fetched messages from this sender
                    lastTimeFetched = lapi.Zscore(msgSid, LAST_FETCH_MSG, senderId)
                }
                
                // Get the last message's timestamp from this sender
                let lastIncomingTS = lapi.Hget(msgSid, LAST_INCOMING_MSG, senderId)
                
                // If the message is newer than the last fetch time, it's unread
                if (lastIncomingTS > lastTimeFetched) {
                    const lastMsg = lapi.Hget(msgSid, senderId, lastIncomingTS)
                    console.log("message_check: NEW MESSAGE from", senderId, JSON.stringify(lastMsg), "at", formatTime(lastIncomingTS))
                    return lastMsg
                }
            }).filter(e => e)
            return messageList  // Return list of most recent unread messages for notification
        }
    } catch(e) {
        console.error("Error message_check", JSON.stringify(request), e)
        return []
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }

    // Simple function to convert timestamp to MM:SS format
    function formatTime(timestamp) {
        if (!timestamp) return "00:00"
        const date = new Date(timestamp)
        const minutes = date.getMinutes().toString().padStart(2, '0')
        const seconds = date.getSeconds().toString().padStart(2, '0')
        return minutes + ":" + seconds
    }
})(request, args)