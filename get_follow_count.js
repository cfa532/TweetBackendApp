((request, args)=>{
    try {
        const FOLLOWERS_LIST = "list_of_followers_mid"
        const FOLLOWINGS_LIST = "list_of_followings_mid"

        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        let follower_keys = lapi.Hkeys(mmsid, FOLLOWERS_LIST)
        let following_keys = lapi.Hkeys(mmsid, FOLLOWINGS_LIST)
        // console.log(userId, "followers list", keys)

        return {followingCount: following_keys.length, followersCount: follower_keys.length}
    } catch(e) {
        console.error("Error get_follow_count", JSON.stringify(request), e)
    }
})(request, args)