((request, args)=>{
/**
 * Add a comment to a tweet.
 *
 * @param {string} tweetId - The ID of the tweet to which the comment is being added.
 * @param {string} comment - The comment object, which is a Tweet object itself.
 * @param {string} [userId] - (Optional) The ID of the user posting the comment.
 */
    const COMMENT_LIST = "comment_list_key"
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const APP_EXT = "com.example.twitterclone"
    const APP_ID = request["aid"]
    const appUserId = request["appuserid"]    // appUser who makes the comment
    const tweetId = request["tweetid"]  // tweet commented to
    const hostId = request["hostid"]    // host where the tweet is published.
    const comment = JSON.parse(request['comment'])

    try {
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        if (nodeId != hostId) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            let ret = lapi.RunMApp("add_comment", {aid: APP_ID, ver: "last",
                nid: hostId, sid: systemSid,
                hostid: hostId, appuserid: appUserId, tweetid: tweetId, comment: request["comment"]}, []
            )
            // sync tweet to node from where appUser is being loaded.
            try {
                lapi.MiMeiSync(systemSid, "", tweetId, {})
                lapi.MiMeiProvide(systemSid, "", tweetId)

                // sync new comment of the tweet to local node
                if (ret.success) {
                    lapi.MiMeiSync(systemSid, "", ret.commentId, {})
                    lapi.MiMeiProvide(systemSid, "", ret.commentId)
                }
            } catch(e) {
                console.error("add_comment: Error sync tweet to local node", e)
            }
            console.log("add_comment remote: comment count", JSON.stringify(ret), nodeId)
            return ret
        } else {
            // if the comment has originalTweetId, publish a new quoted tweet too.
            var retweetId = ""
            if (comment.originalTweetId && comment.originalAuthorId) {
                const ret = lapi.RunMApp("add_tweet", {aid: APP_ID, ver: "last",
                    hostid: hostId, tweet: request['comment']}, [])
                if (ret.success) {
                    retweetId = ret.mid
                }
                delete comment.originalTweetId
                delete comment.originalAuthorId
            }

            // create a new tweet for the comment, which is a tweet object too.
            const authSid = lapi.BELoginAsAuthor()
            const commentId = lapi.MMCreate(authSid, APP_ID, APP_EXT, "{{auto}}", 2, 0x07276704)
            comment["mid"] = commentId
            comment["timestamp"] = Date.now()
    
            const commentSid = lapi.MMOpen(authSid, commentId, "cur")
            lapi.Set(commentSid, TWT_CONTENT_KEY, comment)
            comment.attachments?.forEach(element => {
                // add attachment's reference to comment mid
                lapi.MMAddRef(commentSid, commentId, element.mid)
                element.timestamp = Number(element.timestamp)
            });
            lapi.MMBackup(commentSid, commentId, "", "delref=true")
            lapi.MiMeiPublish(commentSid, "", commentId)     // publish the comment object as a tweet
    
            // add comment to comment_list of the tweet
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            lapi.Zadd(tweetSid, COMMENT_LIST, getScorePair(commentId))
    
            lapi.MMAddRef(tweetSid, tweetId, commentId)
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)
    
            // update the score of the parent tweet in AppData,
            // so that any change in the tweet will be reflected in the AppData.
            lapi.RunMApp("node_update_score", {aid: APP_ID, ver:"last",
                userid: appUserId, mid: tweetId}, [])
    
            // In future, add the comment to appUser's comment list here
            // lapi.RunMApp("add_comment_by_user", {aid: APP_ID, ver:"last",
            //      userid: userId, commentid: commentId}, [])
    
            // return comment mid and number of comments on the tweet.
            let lastSid = lapi.MMOpen("", tweetId, "last")
            const commentCount = lapi.Zcard(lastSid, COMMENT_LIST)
            console.log("add_comment local: ", commentCount, commentId, retweetId)
            return {success: true, mid: commentId, count: commentCount, retweetid: retweetId}
        }
    } catch(e) {
        console.error("Error add_comment", e, JSON.stringify(request))
        return {success: false, message: e}
    }

    function getScorePair(mid) {
        function ScorePair() {}
        sp = new ScorePair
        sp.Score = Date.now()
        sp.Member = mid
        return sp
    }
})(request, args)
