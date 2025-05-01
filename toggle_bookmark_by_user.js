/**
 * Update the user's bookmark list by adding or removing the tweetId.
 * @isBookmarked indicates if the tweetId should be added to bookmark list or not.
 * @return the updated user data.
 */
((request, args)=>{
    const BOOKMARK_LIST = "bookmark_list"
    const APP_ID = request["aid"]
    const userId = request["userid"]
    const tweetId = request["tweetid"]  // tweetID that appUser bookmarked
    const isBookmarked = request["isbookmarked"] == "true" ? true : false

    try {
        /**
         * Boolean value is converted to string in the request.
         */
        const authSid = lapi.BELoginAsAuthor()
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const userData = lapi.RunMApp("toggle_bookmark_by_user",
                { aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    userid: userId, tweetid: tweetId, isbookmarked: isBookmarked}, []
            )
            console.log("toggle_bookmark_by_user remote", JSON.stringify(userData))
            return userData
        } else {
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            try {
                lapi.Begin(userSid, 2)
                if (isBookmarked) {
                    lapi.Hset(userSid, BOOKMARK_LIST, tweetId, Date.now())
                } else {
                    if (lapi.Hget(userSid, BOOKMARK_LIST, tweetId)) {
                        lapi.Hdel(userSid, BOOKMARK_LIST, tweetId)
                    }
                }
                lapi.Commit(userSid)
                lapi.MMBackup(userSid, userId, "", "delref=true")
            } catch(e) {
                lapi.Rollback(userSid)
                throw e
            }
            lapi.MiMeiPublish(userSid, "", userId)
            
            if (isBookmarked) {
                if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(authSid, "", tweetId, {})
                    lapi.MiMeiProvide(authSid, "", tweetId)
                }
            } else {
                // TODO: prevent the tweet from being deleted if it is on the same node
                // lapi.MiMeiUnprovide(authSid, "", tweetId)
                // lapi.MMDelVers(authSid, tweetId)
            }
            const updatedUser = lapi.RunMApp("get_user_core_data", {aid: APP_ID, ver:"last",
                userid: userId}, []
            )
            console.log("toggle_bookmark_by_user local", JSON.stringify(updatedUser))
            return updatedUser
        }
    } catch(e) {
        console.error("toggle_bookmark_by_user error:", e, JSON.stringify(request))
        return lapi.RunMApp("get_user_core_data", {aid: APP_ID, ver:"last",
            userid: userId}, []
        )
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)