((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const BOOKMARK_COUNT = "tweet_bookmark_count"
        const LIKE_COUNT = "tweet_like_count"
        const COMMENT_COUNT = "tweet_comment_count"
        const TWT_LIST_KEY = "list_of_tweets_mid"

        // request, lapi are global variables
        let authorId = request["userid"]
        let mmsid = lapi.MMOpen("", authorId, "last")

        // return a few attributes for preview
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)
        delete user.password

        user["bookmarkCount"] = lapi.Get(mmsid, BOOKMARK_COUNT)
        user["likeCount"] = lapi.Get(mmsid, LIKE_COUNT)
        user["commentCount"] = lapi.Get(mmsid, COMMENT_COUNT)
        user["tweetCount"] = lapi.Zcard(mmsid, TWT_LIST_KEY)

        console.log("get_user_core", JSON.stringify(user))
        return user
    } catch(e) {
        console.error("ERROR get_user_core", JSON.stringify(request), e)
    }
})(request, args)