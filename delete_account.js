
((request, args)=>{
    const TWT_LIST_KEY = "list_of_tweets_mid"
    const APP_ID = request["aid"]
    const userId = request["userid"]

    try {
        const nodeId = lapi.GetVar("", "hostid")
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("delete_account", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid, userid: userId}, []
            )
            return ret
        } else {
            const userSid = lapi.MMOpen("", userId, "last")
            lapi.Zrange(userSid, TWT_LIST_KEY, 0, -1).forEach(e => {
                lapi.RunMApp("delete_tweet", {aid: APP_ID, ver: "last",
                    tweetid: e.Member, userid: userId}, []
                )
            })
            const authSid = lapi.BELoginAsAuthor()
            lapi.MiMeiUnpublish(authSid, "", userId)
            lapi.MMDelVers(authSid, userId)
            return {success: true}
        }
    } catch(e) {
        console.error("Error delete_account:", e, JSON.stringify(request))
        return {success: false}
    }
})(request, args)