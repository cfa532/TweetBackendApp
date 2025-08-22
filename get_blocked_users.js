((request, args)=>{
    const BLOCKED_USERS = "blocked_users"

    try {
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        let keys = lapi.Hkeys(mmsid, BLOCKED_USERS)
        return keys
    } catch(e) {
        console.error("Error get_blocked_users", e, JSON.stringify(request))
    }
})(request, args)