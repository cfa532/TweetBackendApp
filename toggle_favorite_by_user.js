/**
 * Update the user's favorite list by adding or removing the tweetId.
 * @isFavorite indicates if the tweetId should be added to favorite list or not.
 */

((request, args)=>{
    const FAVORITE_LIST = "favorite_list"
    const APP_ID = request["aid"]
    const userId = request["userid"]    // appUser id
    const tweetId = request["tweetid"]  // tweetID that appUser favored
    const isFavorite = request["isfavorite"] == "true" ? true : false

    try {
        /**
         * Boolean value is converted to string in the request.
         */
        const authSid = lapi.BELoginAsAuthor()
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const userData = lapi.RunMApp("toggle_favorite_by_user",
                { aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    userid: userId, tweetid: tweetId, isfavorite: isFavorite }, []
            )
            console.log("toggle_favorite_by_user remote", JSON.stringify(userData))
            return userData     // user local data will be updated by Leither
        } else {
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            try {
                if (isFavorite) {
                    lapi.Hset(userSid, FAVORITE_LIST, tweetId, Date.now())
                } 
                else {
                    if (lapi.Hget(userSid, FAVORITE_LIST, tweetId)) {
                        lapi.Hdel(userSid, FAVORITE_LIST, tweetId)
                    }
                }
                lapi.MMBackup(userSid, userId, "", "delref=true")
            } catch(e) {
                console.error("toggle_favorite_by_user error", e, JSON.stringify(request))
                throw e
            }
            lapi.MiMeiPublish(userSid, "", userId)
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: userId, mid: userId}, [])
                
            if (isFavorite) {
                // if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(authSid, "", tweetId, {})
                    lapi.MiMeiProvide(authSid, "", tweetId)
                // }
            } else {
                // TODO: prevent the tweet from being deleted if it is on the same node
                // lapi.MiMeiUnprovide(authSid, "", tweetId)
                // lapi.MMDelVers(authSid, tweetId)
            }
            const updatedUser = lapi.RunMApp("get_user_core_data", {aid: APP_ID, ver:"last",
                userid: userId}, []
            )
            console.log("toggle_favorite_by_user local", tweetId, JSON.stringify(updatedUser))
            return updatedUser
        }
    } catch(e) {
        console.error("toggle_favorite_by_user error", e, JSON.stringify(request))
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