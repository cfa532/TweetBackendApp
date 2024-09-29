((request, args)=>{
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        let APP_MARK = "στηναρχή"
    
        const FOLLOWINGS_KEY = "list_of_followings_mid"
        const OWNER_DATA_KEY = "data_of_author"
        const BOOKMARK_COUNT = "tweet_bookmark_count"
        const LIKE_COUNT = "tweet_like_count"
        const COMMENT_COUNT = "tweet_comment_count"
        const FANS_COUNT = "user_followers_count"
        const FOLLOWINGS_COUNT = "user_followings_count"

        let authSid = lapi.BELoginAsAuthor()
        APP_MARK = request["phrase"]
        userMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 2, 0x07276704)
        let user = JSON.parse(request["user"])
        user["mid"] = userMid

        let mmsid = lapi.MMOpen(authSid, userMid, "cur")
        // lapi.Hset(mmsid, FOLLOWINGS_KEY, userMid, Date.now())
        lapi.Set(mmsid, OWNER_DATA_KEY, user)      // create default user data area
        lapi.Set(mmsid, BOOKMARK_COUNT, 0)
        lapi.Set(mmsid, LIKE_COUNT, 0)
        lapi.Set(mmsid, COMMENT_COUNT, 0)
        lapi.Set(mmsid, FANS_COUNT, 0)
        lapi.Set(mmsid, FOLLOWINGS_COUNT, 0)
        lapi.MMBackup(authSid, userMid, "")
        lapi.MiMeiPublish(authSid, "", userMid)     // the only time to publish user Mid
        
        delete user.password
        return user
    } catch(e) {
        return e
    }
})(request, args)