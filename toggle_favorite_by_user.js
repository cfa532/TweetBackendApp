/**
 * Update the user's favorite list by adding or removing the tweetId.
 * @isFavorite indicates if the tweetId should be added to favorite list or not.
 */

((request, args)=>{
    const OWNER_DATA_KEY = "data_of_author"
    const FAVORITE_LIST = "favorite_list"
    const APP_ID = request["aid"]
    const userId = request["userid"]

    try {
        const tweetId = request["tweetid"]  // tweetID that appUser bookmarked or favored
        const isFavorite = request["isfavorite"]
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        const user = getUser(userId)
    
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const userData = lapi.RunMApp("toggle_favorite_by_user",
                { aid: APP_ID, ver: "last",
                    nid: user.hostIds[0], sid: systemSid,
                    userid: userId, mid: tweetId, isfavorite: isFavorite }, []
            )
            console.log("Toggle favorite by remote user", isFavorite, nodeId, user.hostIds[0], tweetId, userId)
            // user local data will be updated by Leither
            return userData
        } else {
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

            if (isFavorite) {
                lapi.MiMeiSync(authSid, "", tweetId, {})
                lapi.MiMeiProvide(authSid, "", tweetId)
            } else {
                // TODO: prevent the tweet from being deleted if it is on the same node
                // lapi.MiMeiUnprovide(authSid, "", tweetId)
                // lapi.MMDelVers(authSid, tweetId)
            }
        }
    } catch(e) {
        console.error("toggle user favorite error", e)
        const userSid = lapi.MMOpen("", userId, "last")
        return lapi.Get(userSid, OWNER_DATA_KEY)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)