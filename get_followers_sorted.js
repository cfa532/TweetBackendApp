((request, args)=>{
    try {
        const FOLLOWERS_LIST = "list_of_followers_mid"
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        return lapi.Hgetall(mmsid, FOLLOWERS_LIST)
    } catch(e) {
        console.error("Error get_followers", JSON.stringify(request), e)
    }
})(request, args)