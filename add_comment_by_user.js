/**
 * Update the user's comment list by adding or removing the tweetId.
 * Run the code on node where appUser is provided.
 */
((request, args)=>{
    const OWNER_DATA_KEY = "data_of_author"
    const APP_ID = request["aid"]
    const userId = request["userid"]
    try {
        const user = getUser(userId)    // appUser who made this comment
        const tweetId = request["tweetid"]  // tweetID that appUser commented.
        const nodeId = lapi.GetVar("", "hostid")    // current node id
    
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const userData = lapi.RunMApp("add_comment_by_user", { aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                userid: userId, mid: tweetId }, []
            )
            // user local data will be updated by Leither
            return userData
        } else {
            console.log("Before add comment by user")
            addCommentByUser(tweetId, userId)
            // const authSid = lapi.BELoginAsAuthor();
            // lapi.MiMeiSync(authSid, "", tweetId, {})
            // lapi.MiMeiProvide(authSid, "", tweetId)

            console.log("After add comment by user")
            const userSid = lapi.MMOpen("", userId, "last")
            const userData = lapi.Get(userSid, OWNER_DATA_KEY)
            console.log("add_comment_by_user ret=", JSON.stringify(userData))
            return userData
        }
    } catch(e) {
        console.error("add comment error", e)
        const userSid = lapi.MMOpen("", userId, "last")
        return lapi.Get(userSid, OWNER_DATA_KEY)
    }

    function addCommentByUser(
        tweetId, userId
    ) {
        try {
            const COMMENT_LIST = "comment_list"
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            lapi.Hset(userSid, COMMENT_LIST, tweetId, Date.now())

            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last", userid: userId, mid: userId}, [])
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userId)
        } catch(e) {
            console.error("Error addCommentByUser()", JSON.stringify(request), e)
        }
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)