((request, args)=>{
    try {
        let tweetId = request["tid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        let keys = lapi.Hkeys(mmsid, FOLLOWINGS_LIST)
        console.log("Following", keys)
        return keys
    } catch(e) {
        console.error(e)
    }
})(request, args)