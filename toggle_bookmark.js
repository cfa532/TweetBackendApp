/**
 * Toggle the bookmark status of a tweet by appUser. First, toggle the bookmark status of
 * the tweet by the appUser by updating bookmark list in the tweet.
 * Then update the bookmark tweet list of the appUser by calling another function.
 * 
 * Toggle the bookmark status of a user in the tweet's list. Use the result to update user's
 * bookmark tweet list, so both the tweet and the usser's record of bookmark list in sync.
 * 
 */
((request, args)=>{
    const BOOKMARK_LIST = "tweet_bookmark_list"
    const APP_ID = request["aid"]
    const userId = request["userid"]    // appUser who is bookmarking the tweet
    const tweetId = request["tweetid"]
    const authorId = request["authorid"] // author of the tweet
    const userHostId = request["userhostid"]    // host id of the appUser

    try {
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        const author = getUser(authorId)
        const nodeId = lapi.GetVar("", "hostid")    // current node id

        if (author.hostIds?.findIndex(id => id == nodeId) != 0) {
            let ret = lapi.RunMApp("toggle_bookmark", {aid: APP_ID, ver: "last", 
                nid: author.hostIds[0], sid: systemSid, userhostid: userHostId,
                userid: userId, authorid: authorId, tweetid: tweetId}, []
            )
            // new sync the tweet from the remote host.
            lapi.MiMeiSync(systemSid, "", tweetId, {})
            lapi.MiMeiProvide(systemSid, "", tweetId)
            console.log("Toggle bookmark remote ret=", JSON.stringify(ret))
            return ret
        } else {
            let ret = toggleBookmarkOfTweet(userId, authorId, tweetId)
    
            // toggle the bookmark of the tweet in appUser's node.
            const updatedUser = lapi.RunMApp("toggle_bookmark_by_user", {aid: APP_ID, ver: "last",
                nid: userHostId, sid: systemSid,
                userid: userId, tweetid: tweetId, isbookmarked: ret.hasBookmarked}, []
            )
            console.log("Toggle bookmark of local tweet", JSON.stringify(ret), JSON.stringify(updatedUser))
            return {user: updatedUser, hasBookmarked: ret.hasBookmarked, count: ret.count}
        }
    } catch(e) {
        console.error("Error toggle_bookmark", e, JSON.stringify(request))
    }

    function toggleBookmarkOfTweet(
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
                lapi.Hdel(tweetSid, BOOKMARK_LIST, userId)
            } 
            else {
                lapi.Hset(tweetSid, BOOKMARK_LIST, userId, Date.now())
            }
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(tweetSid, "", tweetId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: authorId, mid: tweetId}, []
            )
            const bookmarkCount = lapi.Hlen(tweetSid, BOOKMARK_LIST)
            return {hasBookmarked: !hasMarked, count: bookmarkCount}
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