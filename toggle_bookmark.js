((request, args)=>{
    const BOOKMARK_LIST = "tweet_bookmark_list"
    const APP_ID = request["aid"]
    const userId = request["userid"]    // appUser who is bookmarking the tweet
    const tweetId = request["tweetid"]

    const authorId = request["authorid"] // author of the tweet
    const author = getUser(authorId)
    const nodeId = lapi.GetVar("", "hostid")    // current node id
    const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

    if (author.hostIds?.findIndex(id => id == nodeId) != 0) {
        // send the request to the remote host
        let ret = lapi.RunMApp("toggle_bookmark", {aid: APP_ID, ver: "last", 
            nid: author.hostIds[0], sid: systemSid,
            userid: userId, authorid: authorId, tweetid: tweetId}, []
        )
        console.log("Toggle bookmark remote ret=", nodeId, JSON.stringify(ret))
        return ret
    } else {
        let ret = toggleBookmark(userId, authorId, tweetId)
        console.log("Toggle bookmark ret=", JSON.stringify(ret))

        // toggle the bookmark of the tweet in appUser's node.
        const user = lapi.RunMApp("toggle_bookmark_by_user", {aid: APP_ID, ver: "last",
            nid: request["userhostid"], sid: systemSid,
            userid: userId, tweetid: tweetId, isbookmarked: ret.hasBookmarked}, [])
        return {user: user, hasBookmarked: ret.hasBookmarked, count: ret.count}
    }

    function toggleBookmark(
        userId,     // appUser who favorites/w the tweet 
        authorId,   // author of the tweet
        tweetId, 
    ) {
        // update bookmark list of a tweet.
        try {
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const hasMarked = lapi.Hget(tweetSid, BOOKMARK_LIST, userId) ? true : false
            if (hasMarked) {
                // If the user has bookmarked, remove the bookmark
                lapi.Hdel(tweetSid, BOOKMARK_LIST, userId)
            } 
            else {
                lapi.Hset(tweetSid, BOOKMARK_LIST, userId, Date.now())
            }
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(tweetSid, "", tweetId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: authorId, mid: tweetId}, [])
            const bookmarkCount = lapi.Hlen(tweetSid, BOOKMARK_LIST)
            return {hasBookmarked: hasMarked ? false : true, count: bookmarkCount}
        } catch(e) {
            console.error("Error toggle_bookmark", JSON.stringify(request), e)
        }    
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)