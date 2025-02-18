((request, args)=>{
    // request, lapi are global variables
    // each comment is a tweet object.
    try {
        const COMMENT_LIST = "comment_list_key"
        const TWT_CONTENT_KEY = "core_data_of_tweet"

        const APP_ID = request["aid"]
        const APP_EXT = "com.example.twitterclone"
        
        // create a new tweet for the comment, which is a tweet object too.
        let authSid = lapi.BELoginAsAuthor()
        let comment = JSON.parse(request["comment"])
        let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
        comment["mid"] = mid
        comment["timestamp"] = Date.now()

        let mmsid = lapi.MMOpen(authSid, mid, "cur")
        lapi.Set(mmsid, TWT_CONTENT_KEY, comment)
        lapi.MMBackup(authSid, mid, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", mid)     // publish the comment's Tweet object

        // add comment to comment_list of the tweet
        let tweetId = request["tweetid"]
        mmsid = lapi.MMOpen(authSid, tweetId, "cur")
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = comment["timestamp"]
        sp.Member = mid
        lapi.Zadd(mmsid, COMMENT_LIST, sp)

        lapi.MMBackup(authSid, tweetId, "", "delref=true")
        comment.attachments.forEach(element => {
            // add attachment's reference to comment mid
            lapi.MMAddRef(authSid, mid, element.mid)
        });
        lapi.MMAddRef(authSid, tweetId, mid)
        lapi.MiMeiPublish(authSid, "", tweetId)

        // return comment mid and number of comments on the tweet.
        return {commentId: mid, count: count}
    } catch(e) {
        console.error("Error add_comment:", JSON.stringify(request), e)
    }
})(request, args)
