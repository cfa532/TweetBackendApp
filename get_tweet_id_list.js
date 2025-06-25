/**
 * Return a list of public tweets of the user from the user's host.
 * To make sure we get the most reliable data.
 */

((request, args)=>{
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const TWT_LIST_KEY = "list_of_tweets_mid"
    const visitorId = request["visitorid"]
    const userId = request["userid"]
    const APP_ID = request["aid"]
    try {
        const user = getUser(userId)
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("get_tweet_id_list", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid, userid: userId}, []
            )
            return ret
        } else {
            const mmsid = lapi.MMOpen("", userId, "last")
            // TODO: -1 might fail. Retreive 100 for now.
            const arr = lapi.Zrevrange(mmsid, TWT_LIST_KEY, 0, 100)
            .map(tweetId => {
                const mmsid = lapi.MMOpen("", tweetId, "last")
                const tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
                if (tweet.isPrivate) {
                    if (tweet.authorId == visitorId) {
                        return tweetId
                    }
                } else {
                    return tweetId
                }
            })
            return arr    
        }
    } catch(e) {
        console.error("Error get_tweet_id_list", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)