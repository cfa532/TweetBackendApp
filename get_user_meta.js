((request, args)=>{
    /**
     * Get bookmarks, favorites and comments list of a user.
     * All tweets should have been synced to the user's node before getting the list.
     * @param {string} type: "comment", "bookmark", "favorite"
     */
    const COMMENT_LIST = "comment_list"
    const BOOKMARK_LIST = "bookmark_list"
    const FAVORITE_LIST = "favorite_list"
    const userId = request["userid"]
    try {
        if (request["type"] == "comment") {
            const mmsid = lapi.MMOpen("", userId, "last")
            return lapi.Hgetall(mmsid, COMMENT_LIST)    // return list of field-value
        } else if (request["type"] == "bookmark") {
            return getTweets(BOOKMARK_LIST)
        } else if (request["type"] == "favorite") {
            return getTweets(FAVORITE_LIST)
        }
    } catch(e) {
        console.error("Error get_user_meta", JSON.stringify(request), e)
    }

    function getTweets(dataType) {
        const mmsid = lapi.MMOpen("", userId, "last")
        const arr = lapi.Hgetall(mmsid, dataType)
        .sort((a, b) => b.Value - a.Value)      // const timestamp = fv.Value
        .map(fv => {
            const tweetId = fv.Field
            let tweet = lapi.RunMApp("get_tweet", {aid: request.aid, ver:"last",
                userid: userId, tweetid: tweetId}, [])
            if (tweet == null) {
                // Double check the tweet has been synced anyway.
                const authSid = lapi.BELoginAsAuthor()
                try {
                    lapi.MiMeiSync(authSid, "", tweetId, {})
                    lapi.MiMeiProvide(authSid, "", tweetId)
                    tweet = lapi.RunMApp("get_tweet", {aid: request.aid, ver:"last",
                        userid: userId, tweetid: tweetId}, [])    
                } catch(e) {
                    console.error("Error get_user_meta sync", tweetId, e)
                }
            }
            return tweet
        }).filter(t => t)
        return arr
    }
})(request, args)