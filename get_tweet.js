((request, args)=>{
    // Take a tweetId as argument. The 2nd argument userId is NOT the author,
    // but the current APP user. It is used to check if the curret app user
    // has liked or bookmarked this tweet.
    try {
        const BOOKMARK_COUNT = "tweet_bookmark_count"
        const RETWEET_COUNT = "tweet_retweet_count"
        const COMMENT_COUNT = "tweet_comment_count"
        const LIKE_COUNT = "tweet_like_count"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const LIKE_LIST = "tweet_like_list"
        const BOOKMARK_LIST = "tweet_bookmark_list"
        const RETWEET_LIST = "tweet_retweet_list"

        // Need to find out if the current user has liked or bookmarked the tweet.
        let appUserId = request["userid"]
        let tweetId = request["tweetid"]
        let mmsid = lapi.MMOpen("", tweetId, "last")
        let tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
        if (!tweet) return null

        // private tweet readable only by author of the tweet
        // if (appUserId != tweet.authorId && tweet.isPrivate) {
        //     return null
        // }

        let bookmarkCount = lapi.Get(mmsid, BOOKMARK_COUNT)
        let retweetCount = lapi.Get(mmsid, RETWEET_COUNT)
        let commentCount = lapi.Get(mmsid, COMMENT_COUNT)
        let likeCount = lapi.Get(mmsid, LIKE_COUNT)

        // check if the appUser has bookmarked or liked the tweet
        let hasLiked = lapi.Hget(mmsid, LIKE_LIST, appUserId)
        let hasBookmarked = lapi.Hget(mmsid, BOOKMARK_LIST, appUserId)
        let hasRetweeted = lapi.Hget(mmsid, RETWEET_LIST, appUserId)

        ret = {
            // tweet core data
            "mid": tweet.mid,
            "authorId": tweet.authorId,
            "title": tweet.title,
            "content": tweet.content,
            "attachments": tweet.attachments,
            "isPrivate": tweet.isPrivate,           // viewable by author only.
            "downloadable": tweet.downloadable,     // if the attachment is downloadable
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
        console.log("Get tweet", JSON.stringify(ret))
        return ret
    } catch(e) {
        console.error("Error get_tweet", JSON.stringify(request), e)
    }
})(request, args)