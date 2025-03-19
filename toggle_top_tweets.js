((request, args)=>{
    /**
     * Toggle pinned tweets and return updated pinned tweets list.
     */
    try {
        const PINNED_TWEETS = "top_tweet_list"
        const APP_ID = request["aid"]
        const tweetId = request["tweetid"]
        const userId = request["userid"]
        const user = getUser(userId)

        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("toggle_top_tweets", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                tweetid: tweetId, userid: userId}, []
            )
            // user mimei will be updated by system.
            console.log("Toggle top tweets remote ret=", JSON.stringify(ret))
            return ret
        } else {
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            const pinned = lapi.Hget(userSid, PINNED_TWEETS, tweetId)
            if (pinned) {
                lapi.Hdel(userSid, PINNED_TWEETS, tweetId)
            } else {
                lapi.Hset(userSid, PINNED_TWEETS, tweetId, Date.now())
            }
            lapi.MMBackup(authSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
            
            return lapi.RunMApp("get_top_tweets", {aid: request["aid"], ver:"last",
                userid: userId}, [])
        }
    } catch(e) {
        console.error("Error toggle_top_tweets", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)