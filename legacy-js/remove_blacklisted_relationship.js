/**
 * Remove a permanently inaccessible user from a follower/following list.
 *
 * This is an idempotent cleanup entry used only after a client has observed
 * 14 continuous access failures spanning at least 7 days. The mutation always
 * runs on the profile owner's hostIds[0].
 *
 * `failurestartedat` is part of the race guard: if the relationship was added
 * or re-added after the failure streak began, it is retained.
 */

((request, args) => {
    const version = request.version || ""
    const APP_ID = request["aid"]
    const ownerId = request["userid"]
    const otherId = request["otherid"]
    const relationshipType = request["relationship"]
    const ownerHostHint = request["userid_hostid"] || null
    const failureStartedAt = Number(request["failurestartedat"])
    const failureCount = Number(request["failurecount"])
    const MIN_FAILURE_COUNT = 14
    const MIN_FAILURE_AGE_MS = 7 * 24 * 60 * 60 * 1000
    const OWNER_DATA_KEY = "data_of_author"
    const FAILED_FOLLOWING_ACCESSES = "failed_following_accesses"
    const LIST_KEYS = {
        followers: "list_of_followers_mid",
        followings: "list_of_followings_mid"
    }

    function wrapResponse(result) {
        if (version === "v2") {
            if (result && typeof result === "object" && "success" in result) {
                return result
            }
            return {success: true, data: result}
        }
        return result
    }

    function wrapError(error) {
        if (version === "v2") {
            return {success: false, message: error.message || String(error), error: error}
        }
        return undefined
    }

    function getUser(mid) {
        const userSid = lapi.MMOpen("", mid, "last")
        return lapi.Get(userSid, OWNER_DATA_KEY)
    }

    try {
        const listKey = LIST_KEYS[relationshipType]
        if (!ownerId || !otherId || ownerId === otherId) {
            throw new Error("Invalid relationship cleanup request")
        }
        if (!listKey) {
            throw new Error("Relationship must be followers or followings")
        }
        if (!Number.isFinite(failureStartedAt) || failureStartedAt <= 0) {
            throw new Error("Missing failure streak start time")
        }
        if (!Number.isSafeInteger(failureCount) || failureCount < MIN_FAILURE_COUNT ||
            Date.now() - failureStartedAt < MIN_FAILURE_AGE_MS) {
            throw new Error("Permanent blacklist threshold not reached")
        }

        const nodeId = lapi.GetVar("", "hostid")
        let owner = null
        try {
            owner = getUser(ownerId)
        } catch(e) {
            lapi.Warn("Tweed remove_blacklisted_relationship: owner unavailable locally, userid=%s, nodeId=%s: %s",
                ownerId, nodeId, e)
        }
        const ownerHostId = Array.isArray(owner?.hostIds) && owner.hostIds.length > 0
            ? owner.hostIds[0]
            : ownerHostHint
        if (!ownerHostId) {
            throw new Error("Profile owner host not found")
        }

        if (nodeId !== ownerHostId) {
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            return wrapResponse(lapi.RunMApp("remove_blacklisted_relationship", {
                aid: APP_ID,
                ver: "last",
                nid: ownerHostId,
                sid: systemSid,
                version: version,
                userid: ownerId,
                otherid: otherId,
                relationship: relationshipType,
                userid_hostid: ownerHostId,
                failurestartedat: failureStartedAt,
                failurecount: failureCount
            }, []))
        }

        // Re-read on hostIds[0]; this copy is authoritative for relationship lists.
        owner = getUser(ownerId)
        if (!owner || !Array.isArray(owner.hostIds) || owner.hostIds[0] !== nodeId) {
            throw new Error("Current node is not the profile owner's authoritative host")
        }

        const authSid = lapi.BELoginAsAuthor()
        let ownerSid = lapi.MMOpen(authSid, ownerId, "last")
        const relationshipValue = lapi.Hget(ownerSid, listKey, otherId)
        if (relationshipValue === undefined || relationshipValue === null) {
            return wrapResponse({removed: false, reason: "not_found"})
        }

        const relationshipAddedAt = Number(relationshipValue)
        if (!Number.isFinite(relationshipAddedAt) || relationshipAddedAt <= 0) {
            lapi.Warn("Tweed remove_blacklisted_relationship: retained relationship with invalid timestamp, userid=%s, otherid=%s, relationship=%s",
                ownerId, otherId, relationshipType)
            return wrapResponse({removed: false, reason: "invalid_relationship_timestamp"})
        }
        if (relationshipAddedAt > failureStartedAt) {
            lapi.Debug("Tweed remove_blacklisted_relationship: retained newer relationship, userid=%s, otherid=%s, relationship=%s, addedAt=%s, failureStartedAt=%s",
                ownerId, otherId, relationshipType, String(relationshipAddedAt), String(failureStartedAt))
            return wrapResponse({removed: false, reason: "relationship_is_newer"})
        }

        ownerSid = lapi.MMOpen(authSid, ownerId, "cur")
        lapi.Hdel(ownerSid, listKey, otherId)
        if (relationshipType === "followings") {
            lapi.Hdel(ownerSid, FAILED_FOLLOWING_ACCESSES, otherId)
        }
        lapi.MMBackup(ownerSid, ownerId, "", "delref=false")
        lapi.MiMeiPublish(authSid, "", ownerId)

        try {
            lapi.RunMApp("node_update_score", {
                aid: APP_ID,
                ver: "last",
                userid: ownerId,
                mid: ownerId
            }, [])
        } catch(e) {
            lapi.Error("Tweed remove_blacklisted_relationship: score update failed, userid=%s: %s", ownerId, e)
        }

        lapi.Warn("Tweed remove_blacklisted_relationship: removed permanently inaccessible %s, userid=%s, otherid=%s",
            relationshipType, ownerId, otherId)
        return wrapResponse({removed: true})
    } catch(e) {
        lapi.Error("Tweed remove_blacklisted_relationship: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)
