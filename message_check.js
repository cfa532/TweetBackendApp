((request, args)=>{
    try {
        const READ_MESSAGE = "read_message_indicator"   // hset of the last time a user message is read.
        const INCOMING_MESSAGE = "incoming_message_indicator"   // index of most recent message received but not fetched.
        const APP_ID = request["aid"]
        const APP_EXT = "com.example.twitterclone"
        const MESSAGE_MIMEI = "message_mimei_1"

        // check the last message from anyone who has sent a message.
        let userId = request["userid"]
        let authSid = lapi.BELoginAsAuthor()
        let msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
        let mmsid = lapi.MMOpen("", msgMid, "last")

        // all users who has sent incoming message.
        let senders = lapi.Hkeys(mmsid, INCOMING_MESSAGE)

        // user IDs whose massage has been fetched last time.
        let idsOfLastFetch = lapi.Zrange(mmsid, READ_MESSAGE, 0, -1).map(e => e.Member)
        console.log("check senders and last fetch:", JSON.stringify(senders), JSON.stringify(idsOfLastFetch))

        let messageList = senders.map(senderId => {
            let index = idsOfLastFetch.findIndex(e => e==senderId)
            let lastTimeFetched = 0;
            if (index > -1) {
                // if there is no Field value of senderId under key READ_MESSAGE, Redis excepts.
                // get timestamp of last fetch
                lastTimeFetched = lapi.Zscore(mmsid, READ_MESSAGE, senderId)
            }
            let lastMsg = lapi.Hget(mmsid, INCOMING_MESSAGE, senderId)
            if (lastMsg.timestamp > lastTimeFetched) {
                return lastMsg
            } else {
                return null
            }
        }).filter(e => e)   // return only non-null results.
        console.log("recent message", JSON.stringify(messageList))
        return messageList  // a list of most recent incoming messages
    } catch(e) {
        console.error("Error message_check", JSON.stringify(request), e)
    }
})(request, args)