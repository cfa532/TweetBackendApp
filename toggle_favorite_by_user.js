/**
 * Update the user's favorite list by adding or removing the tweetId.
 * @isFavorite indicates if the tweetId should be added to favorite list or not.
 */

((request, args)=>{
    const OWNER_DATA_KEY = "data_of_author"
    const APP_ID = request["aid"]
    const userId = request["userid"]
    try {
        const user = getUser(userId)
        const tweetId = request["tweetid"]  // tweetID that appUser bookmarked or favored
        const isFavorite = request["isfavorite"]
    
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        console.log("Toggle favorite by user", nodeId, tweetId, userId, isFavorite, user.hostIds[0])
    
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const userData = lapi.RunMApp("toggle_favorite_by_user",
                { aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    userid: userId, mid: tweetId }, []
            )
            console.log("toggle_favorite_by_user remote ret=", JSON.stringify(userData))
    
            // user local data will be updated by Leither
            return userData
        } else {
            console.log("Before toggleFavorite by user")
            toggleFavoriteByUser(tweetId, userId, isFavorite)
            const authSid = lapi.BELoginAsAuthor();
            if (isFavorite) {
                lapi.MiMeiSync(authSid, "", tweetId, {})
                lapi.MiMeiProvide(authSid, "", tweetId)
            } else {
                // TODO: prevent the tweet from being deleted if it is on the same node
                // lapi.MiMeiUnprovide(authSid, "", tweetId)
                // lapi.MMDelVers(authSid, tweetId)
            }
            console.log("After toggleFavorite by user")
            const userSid = lapi.MMOpen("", userId, "last")
            const userData = lapi.Get(userSid, OWNER_DATA_KEY)
            console.log("toggle_favorite_by_user ret=", JSON.stringify(userData))
            return userData
        }
    } catch(e) {
        console.error("toggle user favorite error", e)
        const userSid = lapi.MMOpen("", userId, "last")
        return lapi.Get(userSid, OWNER_DATA_KEY)
    }

    function toggleFavoriteByUser(
        tweetId, userId, isFavorite
    ) {
        try {
            const FAVORITE_LIST = "favorite_list"
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            if (isFavorite) {
                lapi.Hset(userSid, FAVORITE_LIST, tweetId, Date.now())
            } 
            else {
                lapi.Hdel(userSid, FAVORITE_LIST, tweetId)
            }
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last", userid: userId, mid: userId}, [])
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userId)
        } catch(e) {
            console.error("Error toggleFavoriteByUser()", JSON.stringify(request), e)
        }
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)