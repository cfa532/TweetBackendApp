((request, args)=>{
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"
    let APP_MARK = "στηναρχή"

    const OWNER_DATA_KEY = "data_of_author"
    const BOOKMARK_COUNT = "tweet_bookmark_count"
    const LIKE_COUNT = "tweet_like_count"
    const COMMENT_COUNT = "tweet_comment_count"
    const FANS_COUNT = "user_followers_count"
    const FOLLOWINGS_COUNT = "user_followings_count"
    const TWT_LIST_KEY = "list_of_tweets_mid"

    // request, lapi are global variables
    let authSid = lapi.BELoginAsAuthor()
    let userId = request["userid"]
    if (!userId && request["phrase"]) {
        // registering new user
        APP_MARK = request["phrase"]
        userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 2, 0x07276704)
        // should check if the mid is taken.
        console.log("Create new user.", APP_ID, APP_EXT, APP_MARK, userId)
    }
    let mmsid = lapi.MMOpen(authSid, userId, "cur")
    let user = lapi.Get(mmsid, OWNER_DATA_KEY)
    if (!user) {
        lapi.Set(mmsid, OWNER_DATA_KEY, {mid: userId, timestamp: Date.now()})      // create default user data area
        lapi.Set(mmsid, BOOKMARK_COUNT, 0)
        lapi.Set(mmsid, LIKE_COUNT, 0)
        lapi.Set(mmsid, COMMENT_COUNT, 0)
        lapi.Set(mmsid, FANS_COUNT, 0)
        lapi.Set(mmsid, FOLLOWINGS_COUNT, 0)
        lapi.MMBackup(authSid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)     // the only time to publish user Mid
    }
        
    user = lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last", userid: userId}, [])
    delete user.password
    user["fansList"] = lapi.RunMApp("get_followers", {aid: request["aid"], ver:"last", userid: userId}, [])
    user["followingList"] = lapi.RunMApp("get_followings", {aid: request["aid"], ver:"last", userid: userId}, [])
    user["tweetCount"] = lapi.Zcard(mmsid, TWT_LIST_KEY)

    console.log("init_user_mid", JSON.stringify(user))
    return user
})(request, args)