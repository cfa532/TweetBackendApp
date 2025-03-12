/**
 * Fetch new messages from a given sender.
 */
((request, args)=>{
    const READ_MESSAGE = "read_message_indicator"   // hset of the last time a user message is read.
    const MESSAGE_MIMEI = "message_mimei_1"
    const APP_EXT = "com.example.twitterclone"
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const userId = request["userid"]
    const senderId = request["senderid"]

    try {
        const authSid = lapi.BELoginAsAuthor()
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("message_fetch", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId, senderid: senderId}, []
            )
            return ret
        } else {
            // get Mid of message Mimei
            const msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
            const msgSid = lapi.MMOpen(authSid, msgMid, "cur")
            
            // the last time user fetch message from the sender
            let lastTimeFetched = 0
            lapi.Zrange(msgSid, READ_MESSAGE, 0, -1).map(sp => {
                if (sp.Member == senderId) {
                    lastTimeFetched = sp.Score
                }
            })
            let nowTime = Date.now()
            let tsList = lapi.Zrangebyscore(msgSid, senderId, lastTimeFetched, nowTime, 0, 1000)
            let messages = tsList.map(e => {
                // message from both parties are here, but read only msg from the other.
                return lapi.Hget(msgSid, senderId, e.Member)   // MUST have a return, otherwise null is returned.
            }).filter(e => e)
            console.log("Fetch from", senderId, JSON.stringify(messages), msgMid, lastTimeFetched, nowTime)

            // update message reading indicator
            function ScorePair() {}
            sp = new ScorePair
            sp.Score = Date.now()
            sp.Member = senderId
            lapi.Zadd(msgSid, READ_MESSAGE, sp)  // if memeber exists, score will be updated, otherwise insert.
            lapi.MMBackup(authSid, msgMid, "", "delref=true")
            return messages
        }
    } catch(e) {
        console.error("Error message_fetch:", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)