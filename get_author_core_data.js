(()=>{
    const OWNER_DATA_KEY = "data_of_author"
    const BOOKMARK_COUNT = "tweet_bookmark_count"
    const LIKE_COUNT = "tweet_like_count"
    const COMMENT_COUNT = "tweet_comment_count"
    const FANS_COUNT = "user_followers_count"
    const FOLLOWINGS_COUNT = "user_followings_count"

    // request, lapi are global variables
    let authorId = request["userid"]
    let mmsid = lapi.MMOpen("", authorId, "last")

    // return a few attributes for preview
    let user = lapi.Get(mmsid, OWNER_DATA_KEY)
    user["bookmarkCount"] = lapi.Get(mmsid, BOOKMARK_COUNT)
    user["likeCount"] = lapi.Get(mmsid, LIKE_COUNT)
    user["commentCount"] = lapi.Get(mmsid, COMMENT_COUNT)
    user["fansCount"] = lapi.Get(mmsid, FANS_COUNT)
    user["followingCount"] = lapi.Get(mmsid, FOLLOWINGS_COUNT)
    console.log("get_author_core.", JSON.stringify(user))
    return user
})()