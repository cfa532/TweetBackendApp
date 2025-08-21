
((request, args)=>{
    const BLOCKED_USERS = "blocked_users"
    const FOLLOWINGS_TWEETS = "followings_tweets"
    const FOLLOWINGS_LIST = "list_of_followings_mid"

    try {
        const blocked = request["blocked"]
        const userId = request["userid"]
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("block_user", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                blocked: blocked, userid: userId}, []
            )
            return ret
        } else {
            // If there are attachments, delete all of the references.
            // If not referred, attachments will be deleted by garbage collector
            const authSid = lapi.BELoginAsAuthor()
            const userSid = lapi.MMOpen(authSid, userId, "cur")
            lapi.Hset(userSid, BLOCKED_USERS, blocked, Date.now())

            // unfollow the blocked user
            const sps = lapi.RunMApp("get_tweet_id_list",
                {aid: APP_ID, ver: "last", userid: blocked}, [])
                .map(e => e.Member)
            lapi.Zrem(userSid, FOLLOWINGS_TWEETS, ...sps)
            lapi.Hdel(userSid, FOLLOWINGS_LIST, blocked)
            
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userId)
            return {success: true}
        }
    } catch(e) {
        console.error("Error get_user:", e, JSON.stringify(request))
        return {success: false}
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)