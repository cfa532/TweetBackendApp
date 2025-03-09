((request, args)=>{
    /**
     * Function to add a comment to a specific tweet.
     *
     * @param {string} tweetId - The ID of the tweet to which the comment is being added.
     * @param {string} comment - The comment object, which is a Tweet object itself.
     * @param {string} [userId] - (Optional) The ID of the user posting the comment.
     */
        try {
            const COMMENT_LIST = "comment_list_key"
            const TWT_CONTENT_KEY = "core_data_of_tweet"
            const APP_ID = request["aid"]
            const userId = request["userid"]
            const APP_EXT = "com.example.twitterclone"
            const comment = JSON.parse(request['comment'])
            
            // create a new tweet for the comment, which is a tweet object too.
            let authSid = lapi.BELoginAsAuthor()
            let commentId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
            console.log("Comment ID:", JSON.stringify(comment))
            comment["mid"] = commentId
            comment["timestamp"] = comment["timestamp"] ? comment["timestamp"] : Date.now()
            let commentSid = lapi.MMOpen(authSid, commentId, "cur")
            lapi.Set(commentSid, TWT_CONTENT_KEY, comment)
            comment.attachments?.forEach(element => {
                // add attachment's reference to comment mid
                lapi.MMAddRef(commentSid, commentId, element.mid)
            });
            lapi.MMBackup(commentSid, commentId, "", "delref=true")
            lapi.MiMeiPublish(commentSid, "", commentId)     // publish the comment object as a tweet
            console.log("Comment ID2:", JSON.stringify(comment))
    
            // add comment to comment_list of the tweet
            let tweetId = request["tweetid"]
            let tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            lapi.Zadd(tweetSid, COMMENT_LIST, getScorePair(commentId))
    
            lapi.MMAddRef(tweetSid, tweetId, commentId)
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)
    
            // update the score of the parent tweet in AppData,
            // so that any change in the tweet will be reflected in the AppData.
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: userId, mid: tweetId}, [])
    
            // return comment mid and number of comments on the tweet.
            return {commentId: commentId, count: lapi.Zcard(tweetSid, COMMENT_LIST)}

            function getScorePair(mid) {
                function ScorePair() {}
                sp = new ScorePair
                sp.Score = Date.now()
                sp.Member = mid
                return sp
            }
        } catch(e) {
            console.error("Error add_comment_host", JSON.stringify(request), e)
        }
    })(request, args)
    