/**
 * Tweet has a list of UserId whose has favored it. 
 * User also has a list of TweetId that it has favored. Need to update both of them.
 * 
 * Toggle favorite status of a tweet by appUser. First, toggle the favorite status of
 * the tweet by the appUser by updating favorite list in the tweet.
 * Then update the favorite tweet list of the appUser by calling another function.
 * 
 * Toggle the favorite status of a user in Tweet's list. Use the result to update user's
 * favorite tweet list, so that keep them in sync.
 * 
 * @tweetId MimeiId of the tweet
 * @authorId author of the tweet
 * @userId appUser who favorites the tweet
 */

((request, args)=>{
    const FAVORITE_LIST = "tweet_like_list"
    const APP_ID = request["aid"]
    const userId = request["userid"]    // appUser who favorites the tweet
    const tweetId = request["tweetid"]

    const authorId = request["authorid"]
    const author = getUser(authorId)    // tweet's author, should be available locally.
    const nodeId = lapi.GetVar("", "hostid")  // id of the current node.
    const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

    if (author.hostIds?.findIndex(id => id == nodeId) != 0) {
        // current node is not the author's host, where tweet is published.
        // send the request to that remote host that published the tweet.
        let ret = lapi.RunMApp("toggle_favorite", {aid: APP_ID, ver: "last",
            nid: user.hostIds[0], sid: systemSid,
            userid: userId, authorid: authorId, tweetid: tweetId}, []
        )
        // ret = {user: user, hasLiked: hasLiked, count: count}
        console.log("Toggle favorite remote ret=", nodeId, JSON.stringify(ret))
        return ret
    } else {
        // current node is the author's host, where tweet is published.
        let ret = toggleFavorite(userId, authorId, tweetId)
        console.log("Toggle tweet favorite ret=", nodeId, JSON.stringify(ret))

        // toggle the favorite status of the tweet in appUser's node.
        const user = lapi.RunMApp("toggle_favorite_by_user", {aid: APP_ID, ver: "last",
            nid: request["userhostid"], sid: systemSid,
            userid: userId, tweetid: tweetId, isfavorite: ret.hasLiked}, [])
        return {user: user, hasLiked: ret.hasLiked, count: ret.count}
    }

    // update favorites list within the tweet, then update the score of tweet in AppData
    function toggleFavorite(
        userId,     // appUser who favorites/w the tweet 
        authorId,   // author of the tweet
        tweetId, 
    ) {
        try {
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const isFavorite = lapi.Hget(tweetSid, FAVORITE_LIST, userId) ? true : false
            if (isFavorite) {
                lapi.Hdel(tweetSid, FAVORITE_LIST, userId)
            } 
            else {
                lapi.Hset(tweetSid, FAVORITE_LIST, userId, Date.now())
            }
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(tweetSid, "", tweetId)
    
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: authorId, mid: tweetId}, [])

            // return current favorite count and favorite status by userId (appUser).
            const favoriteCount = lapi.Hlen(tweetSid, FAVORITE_LIST)
            return {hasLiked: isFavorite ? false : true, count: favoriteCount}
        } catch(e) {
            console.error("Error toggle_favorite", JSON.stringify(request), e)
        }    
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)