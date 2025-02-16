// update the number of likes of the tweet by users.
((request, args)=>{
    try {
        const LIKE_COUNT = "tweet_like_count"
        const LIKE_LIST = "tweet_like_list"

        let userId = request["userid"]
        let tweetId = request["tweetid"]
        var authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, tweetId, "cur")

        let count = lapi.Get(mmsid, LIKE_COUNT)
        count = count ? count : 0

        let hasLiked = lapi.Hget(mmsid, LIKE_LIST, userId) ? true : false
        if (hasLiked) {
            lapi.Hdel(mmsid, LIKE_LIST, userId)
            count -= 1
        } 
        else {
            // Use timestamp in place of boolean, for sorting if necessary.
            // Turn it back to boolean when returning to app.
            lapi.Hset(mmsid, LIKE_LIST, userId, Date.now())
            count += 1

            // provide for this tweet when liked it.
        }
        lapi.Set(mmsid, LIKE_COUNT, count)
        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetId)

        console.log("liked=", !hasLiked, count, userId, tweetId)
        return {hasLiked: hasLiked ? false : true, count: count}
    } catch(e) {
        console.error("Error toggle_likes", JSON.stringify(request), e)
    }
})(request, args)