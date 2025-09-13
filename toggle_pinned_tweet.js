((request, args)=>{
    /**
     * Toggle pinned tweets and return updated pinned tweets status.
     */
    try {
        const PINNED_TWEETS = "pinned_tweet_list"
        const APP_ID = request["aid"]
        const tweetId = request["tweetid"]
        const appUserId = request["appuserid"]
        const user = getUser(appUserId)

        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("toggle_pinned_tweet", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                tweetid: tweetId, appuserid: appUserId}, []
            )
            // user mimei will be updated by system.
            console.log("Toggle top tweets remote ret=", JSON.stringify(ret))
            return ret
        } else {
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, appUserId, "cur")
            const pinned = lapi.Hget(userSid, PINNED_TWEETS, tweetId)
            if (pinned) {
                lapi.Hdel(userSid, PINNED_TWEETS, tweetId)
            } else {
                lapi.Hset(userSid, PINNED_TWEETS, tweetId, Date.now())
            }
            lapi.MMBackup(authSid, appUserId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", appUserId)
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: appUserId, mid: appUserId}, [])

            return !pinned
        }
    } catch(e) {
        console.error("Error toggle_pinned_tweet", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)