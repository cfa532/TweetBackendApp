/**
 * Update the user's bookmark list by adding or removing the tweetId.
 * @isBookmarked indicates if the tweetId should be added to bookmark list or not.
 */
((request, args)=>{
    const OWNER_DATA_KEY = "data_of_author"
    const APP_ID = request["aid"]
    const userId = request["userid"]
    try {
        const user = getUser(userId)
        const tweetId = request["tweetid"]  // tweetID that appUser bookmarked or favored
        const isBookmarked = request["isbookmarked"]
    
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        console.log("Toggle bookmark by user", nodeId, tweetId, userId, isBookmarked, user.hostIds[0])
    
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const userData = lapi.RunMApp("toggle_bookmark_by_user",
                { aid: APP_ID, ver: "last",
                    nid: hostId, sid: systemSid,
                    userid: userId, mid: tweetId }, []
            )
            console.log("toggle_bookmark_by_user remote ret=", JSON.stringify(userData))
    
            // user local data will be updated by Leither
            return userData
        } else {
            console.log("Before toggleBookmark by user")
            toggleBookmarkByUser(tweetId, userId, isBookmarked)
            const authSid = lapi.BELoginAsAuthor();
            if (isBookmarked) {
                lapi.MiMeiSync(authSid, "", tweetId, {})
                lapi.MiMeiProvide(authSid, "", tweetId)
            } else {
                lapi.MiMeiUnprovide(authSid, "", tweetId)
                lapi.MMDelVers(authSid, tweetId)
            }
            console.log("After toggleBookmark by user")
            const userSid = lapi.MMOpen("", userId, "last")
            const userData = lapi.Get(userSid, OWNER_DATA_KEY)
            console.log("toggle_bookmark_by_user ret=", JSON.stringify(userData))
            return userData
        }
    } catch(e) {
        console.error("toggle user bookmark error", e)
        const userSid = lapi.MMOpen("", userId, "last")
        return lapi.Get(userSid, OWNER_DATA_KEY)
    }

    function toggleBookmarkByUser(
        tweetId, userId, isBookmarked
    ) {
        try {
            const BOOKMARK_LIST = "bookmark_list"
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            if (isBookmarked) {
                lapi.Hset(userSid, BOOKMARK_LIST, tweetId, Date.now())
            } 
            else {
                lapi.Hdel(userSid, BOOKMARK_LIST, tweetId)
            }
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last", userid: userId, mid: userId}, [])
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userId)
        } catch(e) {
            console.error("Error toggleBookmarkByUser()", JSON.stringify(request), e)
        }
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)