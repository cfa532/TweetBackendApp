((request, args)=>{
    try {
        const FOLLOWERS_LIST = "list_of_followers_mid"

        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        let keys = lapi.Hkeys(mmsid, FOLLOWERS_LIST)
        console.log(userId, "followers list", keys)
        return keys
    } catch(e) {
        console.error("get_followers", JSON.stringify(request), e)
    }
})(request, args)