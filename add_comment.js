(()=>{
    // request, lapi are global variables
    // each comment is a tweet object
    const BOOKMARK_COUNT = "tweet_bookmark_count"
    const RETWEET_COUNT = "tweet_retweet_count"
    const COMMENT_COUNT = "tweet_comment_count"
    const LIKE_COUNT = "tweet_like_count"
    const COMMENT_LIST = "comment_list_key"
    const TWT_CONTENT_KEY = "core_data_of_tweet"

    const APP_ID = "V6MUd0cVeuCFE7YsGLNn5ygyJlm"
    const APP_EXT = "com.example.twitterclone"
    
    // create a new tweet for the comment, which is tweet itself.
    let authSid = lapi.BELoginAsAuthor()
    let comment = JSON.parse(request["comment"])
    let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
    comment["mid"] = mid

    let mmsid = lapi.MMOpen(authSid, mid, "cur")
    lapi.Set(mmsid, TWT_CONTENT_KEY, comment)
    lapi.Set(mmsid, RETWEET_COUNT, 0)
    lapi.Set(mmsid, COMMENT_COUNT, 0)
    lapi.Set(mmsid, LIKE_COUNT, 0)
    lapi.Set(mmsid, BOOKMARK_COUNT, 0)
    lapi.MMBackup(authSid, mid, "")
    // lapi.MiMeiPublish(authSid, "", mid)

    // add comment to comment_list of the tweet
    let tweetId = request["tweetid"]
    mmsid = lapi.MMOpen(authSid, tweetId, "cur")
    function ScorePair() {}
    sp = new ScorePair
    sp.Score = Date.now()
    sp.Member = mid
    lapi.Zadd(mmsid, COMMENT_LIST, sp)

    let count = lapi.Get(mmsid, COMMENT_COUNT) + 1
    lapi.Set(mmsid, COMMENT_COUNT, count)
    lapi.MMBackup(authSid, tweetId, "")
    lapi.MMAddRef(authSid, tweetId, mid)
    // lapi.MiMeiPublish(authSid, "", tweetId)
    console.log("Comment added.", JSON.stringify(comment))

    return {commentId: mid, count: count}
})()
