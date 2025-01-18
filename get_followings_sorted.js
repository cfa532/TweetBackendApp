((request, args)=>{
    try {
        const FOLLOWINGS_LIST = "list_of_followings_mid"
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        return lapi.Hgetall(mmsid, FOLLOWINGS_LIST)
    } catch(e) {
        console.error("Error get_followings", JSON.stringify(request), e)
    }
})(request, args)