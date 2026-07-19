/**
 * Get Followers Function
 *
 * Returns one page of complete user objects for the requested user's followers.
 * Relationship timestamps determine the order, newest first.
 *
 * User objects are read from the local node first. A missing user is synced and
 * provided locally, then read one more time before being omitted from the page.
 *
 * @param {Object} request - The request object
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of the user whose followers are requested
 * @param {number|string} [request.pn=0] - Zero-based page number
 * @param {Array} args - Additional arguments (unused)
 * @returns {Object} Object containing up to 10 user objects and success status
 */

((request, args)=>{
    const PAGE_SIZE = 10
    const FOLLOWERS_LIST = "list_of_followers_mid"
    const version = request.version || ""

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
            return {
                success: false,
                message: error.message || String(error),
                error: error,
                data: {users: []}
            }
        }
        return {users: [], success: false}
    }

    function loadLocalUser(userId) {
        return lapi.RunMApp("get_user_core_data", {
            aid: request.aid,
            ver: "last",
            userid: userId
        }, [])
    }

    function recoverLocalUser(userId) {
        let user = loadLocalUser(userId)
        if (user) return user

        try {
            const authSid = lapi.BELoginAsAuthor()
            lapi.MiMeiSync(authSid, "", userId, {})
            lapi.MiMeiProvide(authSid, "", userId)
        } catch (e) {
            lapi.Error("Tweed get_followers: failed to sync/provide userId=%s: %s", userId, e)
        }

        user = loadLocalUser(userId)
        if (!user) {
            lapi.Error("Tweed get_followers: userId=%s not found after sync/provide", userId)
        }
        return user
    }

    try {
        const parsedPageNumber = parseInt(request.pn, 10)
        const pageNumber = !isNaN(parsedPageNumber) && parsedPageNumber >= 0
            ? parsedPageNumber
            : 0
        const start = pageNumber * PAGE_SIZE
        const mmsid = lapi.MMOpen("", request.userid, "last")
        const relationships = lapi.Hgetall(mmsid, FOLLOWERS_LIST) || []

        const page = relationships
            .sort((a, b) => Number(b.Value) - Number(a.Value))
            .slice(start, start + PAGE_SIZE)

        const users = page
            .map(relationship => recoverLocalUser(relationship.Field))
            .filter(user => !!user)

        return wrapResponse({users: users, success: true})
    } catch (e) {
        lapi.Error("Tweed Error get_followers: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)
