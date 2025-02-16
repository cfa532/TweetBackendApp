((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const FOLLOWINGS_LIST = "list_of_followings_mid"
        const FOLLOWERS_LIST = "list_of_followers_mid"
        const COMMENT_LIST = "comment_list"
        const BOOKMARK_LIST = "bookmark_list"
        const FAVORITE_LIST = "favorite_list"

        // request, lapi are global variables
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        let hostId = lapi.GetVar("", "hostid")

        // return a few attributes for preview
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)
        if (!user)
            return null

        if (hostId == user["hostIds"][0]) {
            console.log("get_user_core_data", userId, "is host")
            user["tweetCount"] = lapi.Zcard(mmsid, TWT_LIST_KEY)
            user["followingCount"] = lapi.Hlen(mmsid, FOLLOWINGS_LIST)
            user["followersCount"] = lapi.Hlen(mmsid, FOLLOWERS_LIST)
            user["bookmarksCount"] = lapi.Hlen(mmsid, BOOKMARK_LIST)
            user["favoritesCount"] = lapi.Hlen(mmsid, FAVORITE_LIST)

            let authSid = lapi.BELoginAsAuthor()
            mmsid = lapi.MMOpen(authSid, userId, "cur")
            lapi.Set(mmsid, OWNER_DATA_KEY, user)
            lapi.MMBackup(mmsid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
        }
        // user["commentsCount"] = lapi.Zcard(mmsid, COMMENT_LIST)

        delete user.password
        return user
    } catch(e) {
        console.error("ERROR get_user_core", JSON.stringify(request), e)
    }
})(request, args)