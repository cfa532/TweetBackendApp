((request, args)=>{
    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }

    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const tweetId = request["tweetid"]    // tweet Id to be removed
        const userId = request["authorid"]
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")    // current node id

        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const req = {aid: APP_ID, ver: "last", nid: user.hostIds[0], sid: systemSid,
                tweetid: tweetId, authorid: userId}
            let ret = lapi.RunMApp("delete_tweet_host", req, [])
            return ret
        } else {
            const req = {aid: APP_ID, ver: "last", tweetid: tweetId, authorid: userId}
            return lapi.RunMApp("delete_tweet_host", req, [])
        }
    } catch(e) {
        console.error("Error delete_tweet", JSON.stringify(request), e)
    }
})(request, args)