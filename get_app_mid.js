(()=>{
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"
    const APP_MARK = "version 0.0.4"

    const FOLLOWINGS_KEY = "list_of_followings_mid"
    const OWNER_DATA_KEY = "data_of_author"
    const BOOKMARK_COUNT = "tweet_bookmark_count"
    const LIKE_COUNT = "tweet_like_count"
    const COMMENT_COUNT = "tweet_comment_count"
    const FANS_COUNT = "user_followers_count"
    const FOLLOWINGS_COUNT = "user_followings_count"

    // request, lapi are global variables
    let authSid = lapi.BELoginAsAuthor()
    let userMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 2, 0x07276704)

    let mmsid = lapi.MMOpen(authSid, userMid, "cur")

    // check if there are data in list of followings. There should be at least the user mid itself
    let len = lapi.Hlen(mmsid, FOLLOWINGS_KEY)
    if (len < 1) {
        lapi.Hset(mmsid, FOLLOWINGS_KEY, userMid, Date.now())
        lapi.Set(mmsid, OWNER_DATA_KEY, {mid: userMid})      // create default user data area
        lapi.Set(mmsid, BOOKMARK_COUNT, 0)
        lapi.Set(mmsid, LIKE_COUNT, 0)
        lapi.Set(mmsid, COMMENT_COUNT, 0)
        lapi.Set(mmsid, FANS_COUNT, 0)
        lapi.Set(mmsid, FOLLOWINGS_COUNT, 0)
        lapi.MMBackup(authSid, userMid, "")
        lapi.MiMeiPublish(authSid, "", userMid)     // the only time to publish user Mid
    }
    let user = lapi.RunMApp("get_author_core_data", {aid: request["aid"], ver:"last", userid: userMid}, [])
    console.log("APP mid=", JSON.stringify(user))
    return {sid: authSid, mid: userMid}
    // console.log(appMid)
    // return appMid
})()