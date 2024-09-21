(() => {
    // let ScorePair = new Function('score', 'member', 'return {score, member}')
    // request, lapi are global variables.
    // each comment is also tweet object.
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"
    const BOOKMARK_COUNT = "tweet_bookmark_count"
    const RETWEET_COUNT = "tweet_retweet_count"
    const COMMENT_COUNT = "tweet_comment_count"
    const LIKE_COUNT = "tweet_like_count"

    // Keys in App mimei database
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const TWT_LIST_KEY = "list_of_tweets_mid"

    let tweet = JSON.parse(request["tweet"])
    let authSid = lapi.BELoginAsAuthor()
    let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
    tweet["mid"] = mid
    console.log("tweet=", JSON.stringify(tweet))

    let mmsid = lapi.MMOpen(authSid, mid, "cur")
    lapi.Set(mmsid, TWT_CONTENT_KEY, tweet)

    lapi.Set(mmsid, RETWEET_COUNT, 0)
    lapi.Set(mmsid, COMMENT_COUNT, 0)
    lapi.Set(mmsid, LIKE_COUNT, 0)
    lapi.Set(mmsid, BOOKMARK_COUNT, 0)
    lapi.MMBackup(authSid, mid, "")
    lapi.MiMeiPublish(authSid, "", mid)     // publish the tweet ID.

    // only add the tweet in author's tweet list if it is not comment only.
    // otherwise only show the comment under the original tweet
    let authorId = tweet["authorId"]

    mmsid = lapi.MMOpen(authSid, authorId, "cur")
    function ScorePair() {}
    sp = new ScorePair
    sp.score = Date.now()
    sp.member = mid
    console.log("appMid=", authorId, JSON.stringify(sp))
    lapi.Zadd(mmsid, TWT_LIST_KEY, sp)
    lapi.MMBackup(authSid, authorId, "")
    lapi.MMAddRef(authSid, authorId, mid)
    // lapi.MiMeiPublish(authSid, "", appMid)
    return mid
})()
