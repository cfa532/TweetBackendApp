/**
 * Tweet has a list of UserId whose has favored it. 
 * User also has a list of TweetId that it has favored. Need to update both of them.
 * 
 * Toggle favorite status of a tweet by appUser. First, toggle the favorite status of
 * the tweet by the appUser by updating favorite list in the tweet.
 * Then update the favorite tweet list of the appUser by calling toggle_favorite_by_user.
 * 
 * Toggle the favorite status of a user in the tweet's list. Use the result to update user's
 * favorite tweet list, so both the tweet and the usser's record of favorite list in sync.
 * 
 * @tweetId MimeiId of the tweet
 * @authorId author of the tweet
 * @userId appUser who favorites the tweet
 */

((request, args)=>{
    const FAVORITE_LIST = "tweet_like_list"
    const APP_ID = request["aid"]
    const appUserId = request["appuserid"]    // appUser who favorites the tweet
    const tweetId = request["tweetid"]
    const authorId = request["authorid"]
    const userHostId = request["userhostid"]    // host id of the appUser

    try {
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        const author = getUser(authorId)    // tweet's author, should be available locally.
        const nodeId = lapi.GetVar("", "hostid")  // id of the current node.
    
        if (!author.hostIds || author.hostIds.length === 0 || author.hostIds[0] !== nodeId) {
            // current node is not the author's host, where tweet is published.
            // send the request to that remote host that published the tweet.
            let ret = lapi.RunMApp("toggle_favorite", {aid: APP_ID, ver: "last",
                nid: author.hostIds[0], sid: systemSid, userhostid: userHostId,
                appuserid: appUserId, authorid: authorId, tweetid: tweetId}, []
            )
            // new sync the tweet from the remote host.
            try {
                // if (!lapi.MFIsExist("", tweetId)) {
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                    lapi.MiMeiProvide(systemSid, "", tweetId)
                // }
            } catch(e) {
                console.error("toggle_favorite Error sync tweet", e, JSON.stringify(ret))
            }
            // ret = {user: user, isFavorite: isFavorite, count: count}
            console.log("toggle_favorite remote tweet", JSON.stringify(ret), appUserId, tweetId)
            return ret
        } else {
            // current node is the author's host, where tweet is published.
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const isFavorite = lapi.Hget(tweetSid, FAVORITE_LIST, appUserId) ? true : false
            if (isFavorite) {
                lapi.Hdel(tweetSid, FAVORITE_LIST, appUserId)
            } 
            else {
                lapi.Hset(tweetSid, FAVORITE_LIST, appUserId, Date.now())
            }
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(tweetSid, "", tweetId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: authorId, mid: tweetId}, []
            )
            // return updated tweet
            const updatedTweet = lapi.RunMApp("get_tweet", {aid: APP_ID, ver: "last",
                tweetid: tweetId, appuserid: appUserId}, []
            )
    
            // toggle the favorite status of the tweet in appUser's node.
            const updatedUser = lapi.RunMApp("toggle_favorite_by_user", {aid: APP_ID, ver: "last",
                nid: userHostId, sid: systemSid,
                userid: appUserId, tweetid: tweetId, isfavorite: updatedTweet.favorites[0]}, []
            )
            console.log("toggle_favorite local tweet", JSON.stringify(updatedTweet), JSON.stringify(updatedUser))
            return {success: true, user: updatedUser, tweet: updatedTweet }
        }
    } catch(e) {
        console.error("Error toggle_favorite", e, JSON.stringify(request))
        return {success: false, error: e}
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)