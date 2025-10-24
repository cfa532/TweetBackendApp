/**
 * MESSAGE FETCH - User Message Reading and Mark as Read
 * 
 * This file handles fetching messages from a specific sender and marking them as read.
 * When a user explicitly requests to read messages from a sender, this function:
 * 1. Retrieves all messages from that sender since the last fetch
 * 2. Updates the READ_MESSAGE indicator to mark messages as read
 * 3. Returns the fetched messages to the user
 * 
 * Algorithm Flow:
 * 1. Get the last time user fetched messages from this sender
 * 2. Retrieve all messages with timestamps newer than the last fetch
 * 3. Update the LAST_FETCH_MSG indicator with current timestamp
 * 4. Return the fetched messages
 */
((request, args)=>{
    // Zset tracking the last time messages from each sender were read.
    // The timestamp is the score, and the member is the sender ID.
    const LAST_FETCH_MSG = "read_message_indicator"
    const MESSAGE_MIMEI = "message_mimei_1"
    const APP_EXT = "us.fireshare.tweet"
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const userId = request["userid"]    // ID of the user fetching messages
    const senderId = request["senderid"] // ID of the sender whose messages to fetch

    try {
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")
        
        // If user's primary node is not the current node, forward to primary node
        if (user.hostIds.findIndex(id => id === nodeId) !== 0) {
            console.log("message_fetch: Forwarding to primary node", user.hostIds[0])
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("message_fetch", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId, senderid: senderId}, []
            )
            return ret
        } else {
            // Get message Mimei for this user
            const authSid = lapi.BELoginAsAuthor()
            const msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
            const msgSid = lapi.MMOpen(authSid, msgMid, "cur")
            
            // Get the last time user fetched messages from this sender
            let lastTimeFetched = 0
            const rank = lapi.Zrank(msgSid, LAST_FETCH_MSG, senderId)
            if (rank > -1) {
                lastTimeFetched = lapi.Zscore(msgSid, LAST_FETCH_MSG, senderId)
            }
            
            // Retrieve all messages from this sender since the last fetch
            // This gets messages with timestamps between lastTimeFetched (exclusive) and nowTime (inclusive)
            // Using (lastTimeFetched + 1) ensures we don't miss messages with exactly equal timestamps
            const nowTime = Date.now()
            let tsList = lapi.Zrangebyscore(msgSid, senderId, lastTimeFetched + 1, nowTime, 0, 1000)
            
            // Extract actual message content for each timestamp
            let messages = tsList.map(e => {
                // Messages from both parties are stored here, but we only read messages from the sender
                const message = lapi.Hget(msgSid, senderId, e.Member)
                console.log("message_fetch:", userId, "fetched", JSON.stringify(message), "from", senderId)
                return message
            }).filter(e => e)  // Filter out any null results
            
            // MARK MESSAGES AS READ by updating the LAST_FETCH_MSG indicator
            // This is the critical step that marks messages as read
            function ScorePair() {}
            const sp = new ScorePair()
            sp.Score = nowTime  // Use current timestamp as the new "last read" time
            sp.Member = senderId
            lapi.Zadd(msgSid, LAST_FETCH_MSG, sp)  // If member exists, score will be updated, otherwise insert
            
            // Backup the Mimei to ensure data persistence
            lapi.MMBackup(authSid, msgMid, "", "delref=true")
            return messages
        }
    } catch(e) {
        console.error("Error message_fetch:", JSON.stringify(request), e)
        return []
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Retrieves user data from the system
     * @param {string} mid - User ID to retrieve data for
     * @returns {Object|null} User data object or null if not found
     */
    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"  // Key for user data in storage
        const mmsid = lapi.MMOpen("", mid, "last")  // Open user's memory space
        return lapi.Get(mmsid, OWNER_DATA_KEY)  // Retrieve user data
    }

    /**
     * Converts timestamp to MM:SS format for display
     * @param {number} timestamp - Timestamp to format
     * @returns {string} Formatted time string (MM:SS)
     */
    function formatTime(timestamp) {
        if (!timestamp) return "00:00"
        const date = new Date(timestamp)
        const minutes = date.getMinutes().toString().padStart(2, '0')
        const seconds = date.getSeconds().toString().padStart(2, '0')
        return minutes + ":" + seconds
    }
})(request, args)