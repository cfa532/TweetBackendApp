((request, args)=>{
    // update bookmark count of a tweet
    try {
        const BOOKMARK_COUNT = "tweet_bookmark_count"
        const BOOKMARK_LIST = "tweet_bookmark_list"

        let userId = request["userid"]    // user id
        let tweetId = request["tweetid"]

        var authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, tweetId, "cur")

        // Get the current bookmark count for the tweet
        let count = lapi.Get(mmsid, BOOKMARK_COUNT)
        count = count ? count : 0

        // Check if the user has already bookmarked the tweet
        let hasMarked = lapi.Hget(mmsid, BOOKMARK_LIST, userId) ? true : false
        if (hasMarked) {
            // If the user has bookmarked, remove the bookmark
            lapi.Hdel(mmsid, BOOKMARK_LIST, userId)
            count -= 1
        } 
        else {
            lapi.Hset(mmsid, BOOKMARK_LIST, userId, Date.now())
            count += 1
        }
        lapi.Set(mmsid, BOOKMARK_COUNT, count)
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetId)
        
        console.log("bookmark=", count, userId, tweetId)

        return {hasBookmarked: hasMarked?false:true, count: count}
    } catch(e) {
        console.error("Error toggle_bookmark", JSON.stringify(request), e)
    }
})(request, args)