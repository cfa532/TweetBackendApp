((request, args)=>{
    // update bookmark count of a tweet
    try {
        const BOOKMARK_LIST = "tweet_bookmark_list"

        let userId = request["userid"]    // appUser who is bookmarking the tweet
        let tweetId = request["tweetid"]
        var authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, tweetId, "cur")

        // Check if the user has already bookmarked the tweet
        let hasMarked = lapi.Hget(mmsid, BOOKMARK_LIST, userId) ? true : false
        if (hasMarked) {
            // If the user has bookmarked, remove the bookmark
            lapi.Hdel(mmsid, BOOKMARK_LIST, userId)
        } 
        else {
            lapi.Hset(mmsid, BOOKMARK_LIST, userId, Date.now())
        }
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetId)
        mmsid = lapi.MMOpen("", tweetId, "last")
        return {hasBookmarked: hasMarked ? false : true,
            count: lapi.Hlen(mmsid, BOOKMARK_LIST)}
    } catch(e) {
        console.error("Error toggle_bookmark", JSON.stringify(request), e)
    }
})(request, args)