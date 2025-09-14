
((request, args)=>{
    const TWT_LIST_KEY = "list_of_tweets_mid"
    const APP_ID = request["aid"]
    const userId = request["userid"]

    try {
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("delete_account", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid, userid: userId}, []
            )
            return ret
        } else {
            try {
                const userSid = lapi.MMOpen("", userId, "last")
                lapi.Zrange(userSid, TWT_LIST_KEY, 0, -1).forEach(e => {
                    lapi.RunMApp("delete_tweet", {aid: APP_ID, ver: "last",
                        tweetid: e.Member, userid: userId}, []
                    )
                })
            } catch(e) {
                console.error("Error delete_account: delete tweets", e, JSON.stringify(request))
            }

            const authSid = lapi.BELoginAsAuthor()
            lapi.MiMeiUnpublish(authSid, "", userId)
            lapi.MMDelVers(authSid, userId)
            console.log("Deleted account ", userId)
            return {success: true}
        }
    } catch(e) {
        console.error("Error delete_account:", e, JSON.stringify(request))
        return {success: false, message: e}
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)