((request, args)=>{
    const READ_MESSAGE = "read_message_indicator"   // hset of the last time a user message is read.
    const INCOMING_MESSAGE = "incoming_message_indicator"   // index of most recent message received but not fetched.
    const APP_ID = request["aid"]
    const APP_EXT = "com.example.twitterclone"
    const MESSAGE_MIMEI = "message_mimei_1"

    try {
        // check the last message from anyone who has sent a message.
        const authSid = lapi.BELoginAsAuthor()
        const msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
        const msgSid = lapi.MMOpen("", msgMid, "last")
        
        const userId = request["userid"]
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("message_check", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId}, []
            )
            return ret
        } else {
            // all users who has sent incoming message.
            const senders = lapi.Hkeys(msgSid, INCOMING_MESSAGE)

            // user IDs whose massage has been fetched last time.
            const idsOfLastFetch = lapi.Zrange(msgSid, READ_MESSAGE, 0, -1).map(e => e.Member)
            console.log("check senders and last fetch:", JSON.stringify(senders),
                JSON.stringify(idsOfLastFetch))
            const messageList = senders.map(senderId => {
                let index = idsOfLastFetch.findIndex(e => e==senderId)
                let lastTimeFetched = 0;
                if (index > -1) {
                    /**
                     * if there is no Field value of senderId under key READ_MESSAGE,
                     * Redis raises exception, no such Field.
                     */
                    lastTimeFetched = lapi.Zscore(msgSid, READ_MESSAGE, senderId)
                }
                let lastMsg = lapi.Hget(msgSid, INCOMING_MESSAGE, senderId)
                if (lastMsg.timestamp > lastTimeFetched) {
                    return lastMsg
                } else {
                    return null
                }
            }).filter(e => e)   // return only non-null results.
            console.log("recent message", JSON.stringify(messageList))
            return messageList  // a list of most recent incoming messages
        }
    } catch(e) {
        console.error("Error message_check", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)