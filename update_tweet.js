/**
 * Update Tweet Content Function
 *
 * This function updates the content field of an existing tweet and can replace
 * its complete attachment list.
 * It handles both local and remote tweet updates, ensuring only tweet authors
 * can modify their content.
 *
 * @param {Object} request - The request object containing update data
 * @param {string} request.aid - Application ID
 * @param {string} request.appuserid - ID of user requesting the update
 * @param {string} request.tweetid - ID of tweet to update
 * @param {string} request.content - New content for the tweet
 * @param {string|Array} [request.attachments] - Complete replacement attachment list
 * @param {boolean|string} [request.downloadable] - Whether tweet attachments can be downloaded
 * @param {boolean|string} [request.isPrivate] - Whether the tweet is private
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
    const hasAttachments = Object.prototype.hasOwnProperty.call(request, "attachments")
    const hasDownloadable = Object.prototype.hasOwnProperty.call(request, "downloadable")
    const hasIsPrivate = Object.prototype.hasOwnProperty.call(request, "isPrivate")

    function parseBooleanOption(name, value) {
        if (typeof value === "boolean") return value
        if (value === "true") return true
        if (value === "false") return false
        throw new Error(name + " must be true or false")
    }

    function parseAttachments(value) {
        const attachments = typeof value === "string" ? JSON.parse(value) : value
        if (!Array.isArray(attachments)) {
            throw new Error("Attachments must be an array")
        }
        attachments.forEach(attachment => {
            if (!attachment || typeof attachment.mid !== "string" || attachment.mid.length === 0) {
                throw new Error("Each attachment must have a valid mid")
            }
            // Coerce a numeric timestamp and leave anything else as the client
            // sent it. Number(undefined) is NaN, which JSON.stringify writes as
            // null, so coercing unconditionally stored null over a missing
            // timestamp — and add_tweet stores whatever arrived, because its own
            // coercion runs after the write.
            const ts = attachment.timestamp
            if (typeof ts === "number" || (typeof ts === "string" && ts.trim() !== "")) {
                const numeric = Number(ts)
                if (Number.isFinite(numeric)) attachment.timestamp = numeric
            }
        })
        return attachments
    }

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
            const remoteRequest = {
                aid: APP_ID,
                ver: "last",
                nid: user.hostIds[0],
                sid: systemSid,
                version: version,
                appuserid: appUserId,
                tweetid: tweetId,
                content: content
            }
            if (hasAttachments) {
                remoteRequest.attachments = request.attachments
            }
            if (hasDownloadable) {
                remoteRequest.downloadable = request.downloadable
            }
            if (hasIsPrivate) {
                remoteRequest.isPrivate = request.isPrivate
            }

            let ret
            try {
                ret = lapi.RunMApp("update_tweet", remoteRequest, [])
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

            // Reconcile references only when attachments were supplied so older
            // content-only clients keep the tweet's current attachment list.
            if (hasAttachments) {
                const nextAttachments = parseAttachments(request.attachments)
                const previousAttachments = Array.isArray(tweet.attachments) ? tweet.attachments : []
                const previousIds = new Set(previousAttachments.map(attachment => attachment.mid))
                const nextIds = new Set(nextAttachments.map(attachment => attachment.mid))

                previousIds.forEach(mid => {
                    if (!nextIds.has(mid)) {
                        lapi.MMDelRef(tweetSid, tweetId, mid)
                    }
                })
                nextIds.forEach(mid => {
                    if (!previousIds.has(mid)) {
                        lapi.MMAddRef(tweetSid, tweetId, mid)
                    }
                })
                tweet.attachments = nextAttachments
            }
            if (hasDownloadable) {
                tweet.downloadable = parseBooleanOption("downloadable", request.downloadable)
            }
            if (hasIsPrivate) {
                tweet.isPrivate = parseBooleanOption("isPrivate", request.isPrivate)
            }

            tweet.content = content
            lapi.Set(tweetSid, TWT_CONTENT_KEY, tweet)
            lapi.MMBackup(authSid, tweetId, "", "delref=false")
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
