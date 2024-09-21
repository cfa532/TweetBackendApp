((request, args)=>{
    try {
        const READ_MESSAGE = "read_message_indicator"   // hset of the last time a user message is read.
        const INCOMING_MESSAGE = "incoming_message_indicator"
        const MESSAGE_MIMEI = "message_mimei"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"

        let authSid = lapi.BELoginAsAuthor()
        let userId = request["userid"]
        let senderId = request["senderid"]

        // get Mid of message Mimei
        let msgMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, userId+"_"+MESSAGE_MIMEI, 2, 0x07276704)
        let mmsid = lapi.MMOpen("", msgMid, "cur")

        // the last time user ever sent a message to the receipt.
        let lastTimeRead = lapi.ZScore(mmsid, READ_MESSAGE, senderId) || 0;
        let tsList = lapi.ZRangeByScore(mmsid, INCOMING_MESSAGE, lastTimeRead, -1)
        let rank = lapi.ZRank(mmsid, INCOMING_MESSAGE, tsList[0].score) // get rank of first element
        let startRank = Math.min(rank-50, 0)
        tsList = lapi.ZRange(mmsid, INCOMING_MESSAGE, startRank, rank) + tsList
        let messages = tsList.map(e => {
            // INCOMING_MESSAGE is key of another zset. Give the same e.member, get the score of
            // its correspoing score in that zset. If null, set the score to zero.
            // compare the score of 2nd zset with e.score, if e.score is larger, return e.member
            lapi.Hget(mmsid, INCOMING_MESSAGE, e.member)
        })
        console.log("Incoming from", msgMid, messages)

        // update message reading indicator. 
        function ScorePair() {}
        sp = new ScorePair
        sp.score = Date.now()
        sp.member = senderId
        lapi.Zadd(mmsid, INCOMING_MESSAGE, sp)

        return messages 
    } catch(e) {
        console.error(e)
    }
})(request, args)