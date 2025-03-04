// update the number of likes of the tweet by users.
((request, args)=>{
    try {
        const LIKE_LIST = "tweet_like_list"

        let userId = request["userid"]  // appUser who is liking the tweet
        let tweetId = request["tweetid"]
        var authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, tweetId, "cur")

        let hasLiked = lapi.Hget(mmsid, LIKE_LIST, userId) ? true : false
        if (hasLiked) {
            lapi.Hdel(mmsid, LIKE_LIST, userId)
        } 
        else {
            // Use timestamp in place of boolean, for sorting if necessary.
            // Turn it back to boolean when returning to app.
            lapi.Hset(mmsid, LIKE_LIST, userId, Date.now())

            // provide for this tweet when liked it.
        }
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetId)

        // update the score of the user in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: tweetId}, [])

        mmsid = lapi.MMOpen("", tweetId, "last")
        return {hasLiked: hasLiked ? false : true,
            count: lapi.Hlen(mmsid, LIKE_LIST)}
    } catch(e) {
        console.error("Error toggle_likes", JSON.stringify(request), e)
    }
})(request, args)