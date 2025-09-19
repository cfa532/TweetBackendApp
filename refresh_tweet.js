/**
 * Different from get_tweet, this function makes sure the current node is up to date.
 * It syncs the tweet from the author's host, and its comments.
 * AppUserId is used to check if it has bookmarked or favored the tweet.
 */
((request, args)=>{
    // Needed to find out if appUser has liked or bookmarked the tweet.
    const appUserId = request["appuserid"]
    const tweetId = request["tweetid"]
    const hostId = request["hostid"]  // main host of the tweet's author
    const authorId = request["userid"]  // author of the tweet

    try {
        const nodeId = lapi.GetVar("", "hostid")
        if (nodeId !== hostId) {
            console.log("refresh_tweet", tweetId, "on", nodeId, "from host", hostId)
            // make sure the current node is up to date.
            lapi.RunMApp("node_update_mid_by_score", {aid: request["aid"], ver:"last",
                hostid: hostId, userid: authorId, mid: tweetId}, [])
        }
        return lapi.RunMApp("get_tweet", {aid: request.aid, ver:"last",
            appuserid: appUserId, tweetid: tweetId}, [])
    } catch(e) {
        console.error("Error refresh_tweet", e, JSON.stringify(request))
    }
})(request, args)