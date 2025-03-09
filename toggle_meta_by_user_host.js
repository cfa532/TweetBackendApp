((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const COMMENT_LIST = "comment_list"
        const BOOKMARK_LIST = "bookmark_list"
        const FAVORITE_LIST = "favorite_list"

        // mimeiId of a tweet that is bookmarked or favored,
        // or comment made by the userId
        let mid = request["mid"]
        let userId = request["userid"]
        var authSid = lapi.BELoginAsAuthor()
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)
        
        let key
        if (request["type"] == "comment") {
            key = COMMENT_LIST
        } else if (request["type"] == "bookmark") {
            key = BOOKMARK_LIST
        } else if (request["type"] == "favorite") {
            key = FAVORITE_LIST
        }

        // Check if the user has already bookmarked the tweet,
        // or favorited the tweet, or commented on the tweet
        let hasValue = lapi.Hget(mmsid, key, mid) ? true : false
        if (hasValue) {
            // If the user has bookmarked, remove the bookmark
            lapi.Hdel(mmsid, key, mid)
        } 
        else {
            lapi.Hset(mmsid, key, mid, Date.now())
        }

        // update the score of the user in AppData
        lapi.RunMApp("node_update_score", {aid: request["aid"], ver:"last",
            userid: userId, mid: mid}, [])

        lapi.MMBackup(authSid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)
        return user
    } catch(e) {
        console.error("Error toggle_meta_by_user_host", JSON.stringify(request), e)
    }
})(request, args)