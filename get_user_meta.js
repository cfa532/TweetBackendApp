((request, args)=>{
    /**
     * Get bookmarks, favorites and comments list of a user.
     */
    try {
        const COMMENT_LIST = "comment_list"
        const BOOKMARK_LIST = "bookmark_list"
        const FAVORITE_LIST = "favorite_list"

        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")

        let key
        if (request["type"] == "comment") {
            key = COMMENT_LIST
        } else if (request["type"] == "bookmark") {
            key = BOOKMARK_LIST
        } else if (request["type"] == "favorite") {
            key = FAVORITE_LIST
        }
        return lapi.Hgetall(mmsid, key)
    } catch(e) {
        console.error("Error get_user_meta", JSON.stringify(request), e)
    }
})(request, args)