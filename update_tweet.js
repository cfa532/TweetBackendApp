/**
 * Update Tweet Content Function
 *
 * This function updates the content field of an existing tweet.
 * It handles both local and remote tweet updates, ensuring only tweet authors
 * can modify their content.
 *
 * @param {Object} request - The request object containing update data
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user requesting the update
 * @param {string} request.tweetid - ID of tweet to update
 * @param {string} request.content - New content for the tweet
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Success status with updated tweet mid
 */
((request, args) => {
    const version = request.version || ""
    const TWT_CONTENT_KEY = "core_data_of_tweet"
    const APP_ID = request["aid"]
    const appUserId = request["appuserid"]
    const tweetId = request["tweetid"]
    const content = request["content"]

    function wrapResponse(result) {
        if (version === 'v2') {
            if (result && typeof result === 'object' && 'success' in result) {
                return result
            }
            return {success: true, data: result}
        }
        return result
    }

    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error}
        }
        return {success: false, message: error.message || String(error)}
    }

    try {
        const nodeId = lapi.GetVar("", "hostid")

        const user = getUser(appUserId)
        if (!user || !user.hostIds || user.hostIds.length === 0) {
            lapi.Error("Tweed update_tweet: missing host for user %s", JSON.stringify({appUserId, nodeId}))
            throw new Error("User not found or missing host")
        }

        // Remote user: delegate to the hosting node
        if (user.hostIds[0] !== nodeId) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)

            let ret
            try {
                ret = lapi.RunMApp("update_tweet", {
                    aid: APP_ID,
                    ver: "last",
                    nid: user.hostIds[0],
                    sid: systemSid,
                    version: version,
                    appuserid: appUserId,
                    tweetid: tweetId,
                    content: content
                }, [])
            } catch(e) {
                lapi.Error("Tweed update_tweet: Failed to call update_tweet on remote node %s: %s, appUserId=%s, tweetId=%s", user.hostIds[0], e, appUserId, tweetId)
                throw e
            }

            lapi.Debug("Tweed update_tweet: remote ret=%s", JSON.stringify(ret))

            try {
                if (ret.success) {
                    lapi.MiMeiSync(systemSid, "", tweetId, {})
                }
            } catch(e) {
                lapi.Error("Tweed update_tweet: remote sync failed: %s, ret=%s", e, JSON.stringify(ret))
            }
            return wrapResponse(ret)
        } else {
            // Local user: update content
            const authSid = lapi.BELoginAsAuthor()
            const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
            const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)

            if (!tweet) {
                throw new Error("Tweet not found")
            }

            if (tweet.authorId !== appUserId) {
                throw new Error("Only the tweet author can update content")
            }

            // Overwrite content field only
            tweet.content = content
            lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)
            lapi.MMBackup(authSid, tweetId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", tweetId)

            lapi.Debug("Tweed update_tweet: local tweet=%s", JSON.stringify(tweet))
            return wrapResponse({success: true, mid: tweetId})
        }
    } catch(e) {
        lapi.Error("Tweed Error update_tweet: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }

    function getUser(mid) {
        try {
            const OWNER_DATA_KEY = "data_of_author"
            const mmsid = lapi.MMOpen("", mid, "last")
            return lapi.Get(mmsid, OWNER_DATA_KEY)
        } catch(e) {
            lapi.Error("Tweed update_tweet: getUser failed for mid=%s: %s", mid, e)
            throw e
        }
    }
})(request, args)
