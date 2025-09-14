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

        if (!author.hostIds || author.hostIds.length === 0 || author.hostIds[0] !== nodeId) {
            let ret = lapi.RunMApp("toggle_bookmark", {aid: APP_ID, ver: "last", 
                nid: author.hostIds[0], sid: systemSid, userhostid: userHostId,
                userid: userId, authorid: authorId, tweetid: tweetId}, []
            )
            // now sync the tweet from the remote host.
            try {
                // if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                    lapi.MiMeiProvide(systemSid, "", tweetId)
                // }
            } catch(e) {
                console.error("toggle_bookmark Error provide tweet", e, JSON.stringify(ret))
            }
            console.log("toggle_bookmark remote ret=", JSON.stringify(ret))
            return ret
        } else {
            const updatedTweet = toggleBookmarkOfTweet(userId, authorId, tweetId)
            // toggle the bookmark of the tweet in appUser's node.
            const updatedUser = lapi.RunMApp("toggle_bookmark_by_user", {aid: APP_ID, ver: "last",
                nid: userHostId, sid: systemSid,
                userid: userId, tweetid: tweetId, isbookmarked: updatedTweet.favorites[1]}, []
            )
            console.log("toggle_bookmark local tweet", JSON.stringify(updatedTweet), JSON.stringify(updatedUser))
            return {success: true, user: updatedUser, tweet: updatedTweet}
        }
    } catch(e) {
        console.error("toggle_bookmark error", e, JSON.stringify(request))
        return {success: false, error: e}
    }

    function toggleBookmarkOfTweet(
        appUserId,     // appUser who favorites/w the tweet 
        authorId,   // author of the tweet
        tweetId, 
    ) {
        // update bookmark list of a tweet.
        try {
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const hasMarked = lapi.Hget(tweetSid, BOOKMARK_LIST, appUserId) ? true : false
            if (hasMarked) {
                lapi.Hdel(tweetSid, BOOKMARK_LIST, appUserId)
            } 
            else {
                lapi.Hset(tweetSid, BOOKMARK_LIST, appUserId, Date.now())
            }
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(tweetSid, "", tweetId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: authorId, mid: tweetId}, []
            )
            // return updated tweet
            return lapi.RunMApp("get_tweet", {aid: APP_ID, ver: "last",
                tweetid: tweetId, appuserid: appUserId}, []
            )
        } catch(e) {
            console.error("Error toggleBookmarkOfTweet", JSON.stringify(request), e)
            return null
        }    
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)