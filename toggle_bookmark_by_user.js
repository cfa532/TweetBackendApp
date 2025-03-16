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
            console.log("Toggle bookmark of remote user", JSON.stringify(request))
            return userData
        } else {
            console.log("Toggle bookmark of local user", JSON.stringify(request))
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            if (isBookmarked) {
                lapi.Hset(userSid, BOOKMARK_LIST, tweetId, Date.now())
            } 
            else {
                lapi.Hdel(userSid, BOOKMARK_LIST, tweetId)
            }
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userId)
            
            if (isBookmarked) {
                // lapi.MiMeiSync(authSid, "", tweetId, {})
                lapi.MiMeiProvide(authSid, "", tweetId)
            } else {
                // TODO: prevent the tweet from being deleted if it is on the same node
                // lapi.MiMeiUnprovide(authSid, "", tweetId)
                // lapi.MMDelVers(authSid, tweetId)
            }
            const updatedUser = lapi.RunMApp("get_user_core_data", {aid: APP_ID, ver:"last",
                userid: userId}, []
            )
            return updatedUser
        }
    } catch(e) {
        console.error("Toggle user bookmark error", e, JSON.stringify(request))
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