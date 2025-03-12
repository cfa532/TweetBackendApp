((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const FOLLOWINGS_LIST = "list_of_followings_mid"
        const FOLLOWERS_LIST = "list_of_followers_mid"
        const COMMENT_LIST = "comment_list"
        const BOOKMARK_LIST = "bookmark_list"
        const FAVORITE_LIST = "favorite_list"
        const RETWEET_LIST = "tweet_retweet_list"

        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)
        if (!user)
            return null

        user["tweetCount"] = lapi.Zcard(mmsid, TWT_LIST_KEY) + lapi.Hlen(mmsid, RETWEET_LIST)
        user["followingCount"] = lapi.Hlen(mmsid, FOLLOWINGS_LIST)
        user["followersCount"] = lapi.Hlen(mmsid, FOLLOWERS_LIST)
        user["bookmarksCount"] = lapi.Hlen(mmsid, BOOKMARK_LIST)
        user["favoritesCount"] = lapi.Hlen(mmsid, FAVORITE_LIST)
        user["commentsCount"] = lapi.Hlen(mmsid, COMMENT_LIST)
        user["nodeId"] = lapi.GetVar("", "hostid")
        
        delete user.password
        console.log("accessible user", JSON.stringify(user))
        return user
    } catch(e) {
        console.error("ERROR get_user_core", JSON.stringify(request), e)
    }
})(request, args)