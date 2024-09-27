(()=>{
    // request, lapi are global variables
    // data necessary to display a tweet item in list
    // const AUTHOR_MID = "tweet_author_id"
    const BOOKMARK_COUNT = "tweet_bookmark_count"
    const RETWEET_COUNT = "tweet_retweet_count"
    const COMMENT_COUNT = "tweet_comment_count"
    const LIKE_COUNT = "tweet_like_count"
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const LIKE_LIST = "tweet_like_list"
    const BOOKMARK_LIST = "tweet_bookmark_list"
    const RETWEET_LIST = "tweet_retweet_list"

    let tweetId = request["tweetid"]
    let userId = request["userid"]
    let mmsid = lapi.MMOpen("", tweetId, "last")
    let tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
    
    if (!tweet) return null

    let bookmarkCount = lapi.Get(mmsid, BOOKMARK_COUNT)
    let retweetCount = lapi.Get(mmsid, RETWEET_COUNT)
    let commentCount = lapi.Get(mmsid, COMMENT_COUNT)
    let likeCount = lapi.Get(mmsid, LIKE_COUNT)

    // check if the viewer has bookmarked or liked the tweet
    let hasLiked = lapi.Hget(mmsid, LIKE_LIST, userId)
    let hasBookmarked = lapi.Hget(mmsid, BOOKMARK_LIST, userId)
    let hasRetweeted = lapi.Hget(mmsid, RETWEET_LIST, userId)
    ret = {
        // tweet core data
        "mid": tweet.mid,
        "authorId": tweet.authorId,
        "content": tweet.content,
        "attachments": tweet.attachments,
        "isPrivate": tweet.isPrivate,
        "originalTweetId": tweet.originalTweetId,
        "originalAuthorId": tweet.originalAuthorId,
        "timestamp": tweet.timestamp,
        "bookmarkCount": bookmarkCount,
        "retweetCount": retweetCount,
        "commentCount": commentCount,
        "likeCount": likeCount,
        "favorites": [
            hasLiked ? true : false,
            hasBookmarked ? true : false,
            hasRetweeted ? true : false,
        ],
    }
    console.log("Tweet=", JSON.stringify(ret))
    return ret
})()