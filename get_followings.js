((request, args)=>{
    try {
        const FOLLOWINGS_LIST = "list_of_followings_mid"

        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        let keys = lapi.Hkeys(mmsid, FOLLOWINGS_LIST)
        console.log(userId, "following", keys)
        return keys
    } catch(e) {
        console.error(e)
    }
})(request, args)