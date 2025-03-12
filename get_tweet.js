/**
 * Get a tweet from its author's node. Not necessary its host, which has the latest data.
 * The current node may be out of date, but get it anyway for better user experience.
 * When the user opens the tweet detail page, call refresh_tweet to update current node.
 */
((request, args)=>{
    // Take a tweetId as argument. The 2nd argument userId is NOT the author,
    // but the current APP user. It is used to check if the curret app user
    // has liked or bookmarked this tweet.
    try {
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const FAVORITE_LIST = "tweet_like_list"
        const BOOKMARK_LIST = "tweet_bookmark_list"
        const RETWEET_LIST = "tweet_retweet_list"
        const COMMENT_LIST = "comment_list_key"

        // Need to find out if the current user has liked or bookmarked the tweet.
        const appUserId = request["userid"]
        const tweetId = request["tweetid"]
        const mmsid = lapi.MMOpen("", tweetId, "last")
        const tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
        if (!tweet)
            return null

        // check if the appUser has bookmarked or liked the tweet
        const hasLiked = lapi.Hget(mmsid, FAVORITE_LIST, appUserId)
        const hasBookmarked = lapi.Hget(mmsid, BOOKMARK_LIST, appUserId)
        const hasRetweeted = lapi.Hget(mmsid, RETWEET_LIST, appUserId)
        let ret = {
            // tweet core data
            "mid": tweet.mid,
            "authorId": tweet.authorId,
            "title": tweet.title,
            "attachments": tweet.attachments,
            "isPrivate": tweet.isPrivate,           // viewable by author only.
            "downloadable": tweet.downloadable,     // if the attachment is downloadable
            "originalTweetId": tweet.originalTweetId,
            "originalAuthorId": tweet.originalAuthorId,
            "timestamp": tweet.timestamp,
            "bookmarkCount": lapi.Hlen(mmsid, BOOKMARK_LIST),
            "likeCount": lapi.Hlen(mmsid, FAVORITE_LIST),
            "commentCount": lapi.Zcard(mmsid, COMMENT_LIST),
            "retweetCount": lapi.Hlen(mmsid, RETWEET_LIST),
            "favorites": [
                hasLiked ? true : false,
                hasBookmarked ? true : false,
                hasRetweeted ? true : false,
            ],
        }
        if (tweet.content)
            ret["content"] = tweet.content  // prevent null from becoming empty string.
        return ret
    } catch(e) {
        console.error("Error get_tweet", JSON.stringify(request), e)
        return null
    }
})(request, args)