// update the number of likes of the tweet by users.
((request, args)=>{
    function toggleFavorite(
        userId, authorId, tweetId, appId
    ) {
        try {
            const LIKE_LIST = "tweet_like_list"
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const hasLiked = lapi.Hget(tweetSid, LIKE_LIST, userId) ? true : false
            if (hasLiked) {
                lapi.Hdel(tweetSid, LIKE_LIST, userId)
            } 
            else {
                // Use timestamp in place of boolean, for sorting if necessary.
                // Turn it back to boolean when returning to app.
                lapi.Hset(tweetSid, LIKE_LIST, userId, Date.now())
    
                // provide for this tweet when liked it.
            }
            lapi.MMBackup(authSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: appId, ver:"last",
                userid: authorId, mid: tweetId}, [])
    
            return {hasLiked: hasLiked ? false : true,
                count: lapi.Hlen(tweetSid, LIKE_LIST)}
        } catch(e) {
            console.error("Error toggle_favorite", JSON.stringify(request), e)
        }    
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }

    const userId = request["userid"]    // appUser who favorites the tweet
    const tweetId = request["tweetid"]
    const APP_ID = request["aid"]
    const authorId = request["authorid"] // author of the tweet
    const author = getUser(authorId)

    const nodeId = lapi.GetVar("", "hostid")    // current node id
    if (author.hostIds?.findIndex(id => id == nodeId) != 0) {
        // send the request to the remote host
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        const req = {aid: APP_ID, ver: "last", nid: user.hostIds[0], sid: systemSid,
            userid: userId, authorid: authorId, tweetid: tweetId}
        let ret = lapi.RunMApp("toggle_favorite", req, [])
        console.log("Toggle favorite remote ret=", JSON.stringify(ret))
        return ret
    } else {
        let ret = toggleFavorite(userId, authorId, tweetId, APP_ID)
        console.log("Toggle favorite ret=", JSON.stringify(ret))
        return ret
    }
})(request, args)