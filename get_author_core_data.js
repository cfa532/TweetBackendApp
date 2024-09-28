(()=>{
    const OWNER_DATA_KEY = "data_of_author"
    const BOOKMARK_COUNT = "tweet_bookmark_count"
    const LIKE_COUNT = "tweet_like_count"
    const COMMENT_COUNT = "tweet_comment_count"

    // request, lapi are global variables
    let authorId = request["userid"]
    let mmsid = lapi.MMOpen("", authorId, "last")

    // return a few attributes for preview
    let user = lapi.Get(mmsid, OWNER_DATA_KEY)
    user["bookmarkCount"] = lapi.Get(mmsid, BOOKMARK_COUNT)
    user["likeCount"] = lapi.Get(mmsid, LIKE_COUNT)
    user["commentCount"] = lapi.Get(mmsid, COMMENT_COUNT)
    console.log("get_author_core.", JSON.stringify(user))
    return user
})()