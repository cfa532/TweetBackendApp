((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const COMMENT_LIST = "comment_list"
        const BOOKMARK_LIST = "bookmark_list"
        const FAVORITE_LIST = "favorite_list"
        const COMMENT_COUNT = "commentsCount"
        const BOOKMARK_COUNT = "bookmarksCount"
        const FAVORITE_COUNT = "favoritesCount"

        let mid = request["mid"]
        let userId = request["userid"]
        var authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)
        let key, keyCount
        if (request["type"] == "comment") {
            key = COMMENT_LIST
            keyCount = COMMENT_COUNT
        } else if (request["type"] == "bookmark") {
            key = BOOKMARK_LIST
            keyCount = BOOKMARK_COUNT
        } else if (request["type"] == "favorite") {
            key = FAVORITE_LIST
            keyCount = FAVORITE_COUNT
        }
        
        // Check if the user has already bookmarked the tweet
        let hasValue = lapi.Hget(mmsid, key, mid) ? true : false
        if (hasValue) {
            // If the user has bookmarked, remove the bookmark
            lapi.Hdel(mmsid, key, mid)
            user[keyCount] = user[keyCount]>0 ? user[keyCount]-1 : 0
        } 
        else {
            lapi.Hset(mmsid, key, mid, Date.now())
            user[keyCount] += 1
        }
        lapi.MMBackup(authSid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)
        
        console.log("toggle_meta_by_user", key, userId, mid)
        return user
    } catch(e) {
        console.error("Error toggle_meta_by_user", JSON.stringify(request), e)
    }
})(request, args)