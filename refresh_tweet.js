((request, args)=>{
    // Take a tweetId as argument. The 2nd argument userId is NOT the author,
    // but the current APP user. It is used to check if the curret app user
    // has liked or bookmarked this tweet.
    try {
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const LIKE_LIST = "tweet_like_list"
        const BOOKMARK_LIST = "tweet_bookmark_list"
        const RETWEET_LIST = "tweet_retweet_list"
        const COMMENT_LIST = "comment_list_key"

        // Need to find out if the current user has liked or bookmarked the tweet.
        let appUserId = request["appuserid"]
        let tweetId = request["tweetid"]
        let hostId = request["hostid"]  // main host of the tweet's author
        let nodeId = request["nodeid"]  // node from which the tweet is loaded.
        let userId = request["userid"]  // author of the tweet
        
        if (nodeId != hostId) {
            console.log("Refresh tweet from a different host", hostId, nodeId, userId, tweetId)
            // loading tweet from a different host. Need to check the score.
            lapi.RunMApp("node_update_tweet", {aid: request["aid"], ver:"last",
                hostid: hostId, userid: userId, mid: tweetId}, [])
        }
        let mmsid = lapi.MMOpen("", tweetId, "last")
        let tweet = lapi.Get(mmsid, TWT_CONTENT_KEY)
        if (!tweet)
            return null

        // check if the appUser has bookmarked or liked the tweet
        let hasLiked = lapi.Hget(mmsid, LIKE_LIST, appUserId)
        let hasBookmarked = lapi.Hget(mmsid, BOOKMARK_LIST, appUserId)
        let hasRetweeted = lapi.Hget(mmsid, RETWEET_LIST, appUserId)
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
            "bookmarkCount": lapi.Hlen(mmsid, BOOKMARK_LIST),
            "likeCount": lapi.Hlen(mmsid, LIKE_LIST),
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
        console.error("Error refresh_tweet", JSON.stringify(request), e)
    }
})(request, args)