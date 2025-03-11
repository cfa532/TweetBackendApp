/**
 * appUserId is used to check if it has bookmarked or favored the tweet.
 */
((request, args)=>{
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const LIKE_LIST = "tweet_like_list"
    const BOOKMARK_LIST = "tweet_bookmark_list"
    const RETWEET_LIST = "tweet_retweet_list"
    const COMMENT_LIST = "comment_list_key"

    try {
        // Need to find out if appUser has liked or bookmarked the tweet.
        const appUserId = request["appuserid"]
        const tweetId = request["tweetid"]
        const hostId = request["hostid"]  // main host of the tweet's author
        const authorId = request["userid"]  // author of the tweet
        
        const nodeId = lapi.GetVar("", "hostid")
        if (nodeId != hostId) {
            console.log("Refresh tweet from a different host", hostId, nodeId, authorId, tweetId)
            // loading tweet from a node other than author's host,
            // make sure the current node is up to date.
            lapi.RunMApp("node_update_tweet", {aid: request["aid"], ver:"last",
                hostid: hostId, userid: authorId, tweetid: tweetId}, [])
        }
        const tweetSid = lapi.MMOpen("", tweetId, "last")
        const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
        if (!tweet)
            return null

        // check if the appUser has bookmarked or liked the tweet
        const hasFavored = lapi.Hget(tweetSid, LIKE_LIST, appUserId)
        const hasBookmarked = lapi.Hget(tweetSid, BOOKMARK_LIST, appUserId)
        const hasRetweeted = lapi.Hget(tweetSid, RETWEET_LIST, appUserId)
        ret = {
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
            "bookmarkCount": lapi.Hlen(tweetSid, BOOKMARK_LIST),
            "likeCount": lapi.Hlen(tweetSid, LIKE_LIST),
            "commentCount": lapi.Zcard(tweetSid, COMMENT_LIST),
            "retweetCount": lapi.Hlen(tweetSid, RETWEET_LIST),
            "favorites": [
                hasFavored ? true : false,
                hasBookmarked ? true : false,
                hasRetweeted ? true : false,
            ],
        }
        if (tweet.content)
            ret["content"] = tweet.content  // prevent null from becoming empty string.
        return ret
    } catch(e) {
        console.error("Error refresh_tweet", JSON.stringify(request), e)
    }
})(request, args)