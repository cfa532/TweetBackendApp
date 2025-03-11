// ((request, args)=>{
    /**
     * Function to add a comment to a specific tweet.
     *
     * @param {string} tweetId - The ID of the tweet to which the comment is being added.
     * @param {string} comment - The comment object, which is a Tweet object itself.
     * @param {string} [userId] - (Optional) The ID of the user posting the comment.
     */

    function getScorePair(mid) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = Date.now()
        sp.Member = mid
        return sp
    }

    try {
        const COMMENT_LIST = "comment_list_key"
        const TWT_CONTENT_KEY = "core_data_of_tweet"
        const APP_ID = request["aid"]
        const userId = request["userid"]
        const APP_EXT = "com.example.twitterclone"
        const comment = JSON.parse(request['comment'])
        
        // create a new tweet for the comment, which is a tweet object too.
        const authSid = lapi.BELoginAsAuthor()
        const commentId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
        comment["mid"] = commentId
        comment["timestamp"] = comment["timestamp"] ? comment["timestamp"] : Date.now()
        const commentSid = lapi.MMOpen(authSid, commentId, "cur")
        lapi.Set(commentSid, TWT_CONTENT_KEY, comment)
        comment.attachments?.forEach(element => {
            // add attachment's reference to comment mid
            lapi.MMAddRef(commentSid, commentId, element.mid)
        });
        lapi.MMBackup(commentSid, commentId, "", "delref=true")
        lapi.MiMeiPublish(commentSid, "", commentId)     // publish the comment object as a tweet

        // add comment to comment_list of the tweet
        const tweetId = request["tweetid"]
        const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
        lapi.Zadd(tweetSid, COMMENT_LIST, getScorePair(commentId))

        lapi.MMAddRef(tweetSid, tweetId, commentId)
        lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", tweetId)

        // update the score of the parent tweet in AppData,
        // so that any change in the tweet will be reflected in the AppData.
        lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
            userid: userId, mid: tweetId}, [])

        // In future, add the comment to appUser's comment list here
        // lapi.RunMApp("add_comment_by_user", {aid: APP_ID, ver:"last",
        //      userid: userId, commentid: commentId}, [])

        // return comment mid and number of comments on the tweet.
        const commentCount = lapi.Zcard(tweetSid, COMMENT_LIST)
        JSON.stringify({commentId: commentId, count: commentCount})     // NO return statement here
    } catch(e) {
        console.error("Error add_comment_host", e, JSON.stringify(request))
    }
// })(request, args)