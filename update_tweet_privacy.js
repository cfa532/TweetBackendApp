/**
 * Update tweet privacy by toggling the isPrivate property.
 * Delegates to the author's primary host if not currently on that node.
 */
((request, args) => {
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const APP_ID = request["aid"]
    const appUserId = request["appuserid"]
    const tweetId = request["tweetid"]

    try {
        const nodeId = lapi.GetVar("", "hostid")    // current node id
        
        // Get user data to determine primary host
        const user = getUser(appUserId)
        if (!user) {
            throw new Error("User not found")
        }

        // Check if we need to delegate to the user's primary host
        if (!user.hostIds || user.hostIds.length === 0 || user.hostIds[0] !== nodeId) {
            // send the request to the remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

            const ret = lapi.RunMApp("update_tweet_privacy", {
                aid: APP_ID, 
                ver: "last",
                nid: user.hostIds[0], 
                sid: systemSid,
                appuserid: appUserId, 
                tweetid: tweetId
            }, [])
            
            console.log("update_tweet_privacy remote ret=", JSON.stringify(ret))
            
            try {
                if (typeof ret === 'boolean') {
                    // Remote call returned boolean directly
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                    return ret
                }
            } catch(e) {
                console.error("Error update_tweet_privacy: remote sync failed.", e, JSON.stringify(ret), JSON.stringify(request))
            }
        } else {
            // We are on the user's primary host, perform the update locally
            const authSid = lapi.BELoginAsAuthor()
            
            // Open the tweet for editing
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
            
            if (!tweet) {
                throw new Error("Tweet not found")
            }
            
            // Verify the user is the author of the tweet
            if (tweet.authorId !== appUserId) {
                throw new Error("Only the tweet author can update privacy settings")
            }
            
            // Toggle the isPrivate property
            tweet.isPrivate = !tweet.isPrivate
            
            // Update the tweet in storage
            lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)
            lapi.MMBackup(tweetSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)
            
            console.log("update_tweet_privacy local", JSON.stringify(tweet))
            return tweet.isPrivate ? true : false
        }
    } catch(e) {
        console.error("Error update_tweet_privacy", e, JSON.stringify(request))
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)
