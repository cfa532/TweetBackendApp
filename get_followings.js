/**
 * Given a list of userIds, return a list of user objects.
 */

((request, args)=>{
    try {
        const FOLLOWINGS_LIST = "list_of_followings_mid"
        let userId = request["userid"]
        let mmsid = lapi.MMOpen("", userId, "last")
        const userIds = lapi.Hkeys(mmsid, FOLLOWINGS_LIST)
        const users = userIds.map(userId => {
            return lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last",
                userid: userId}, [])
        }).filter(e=> e)
        return {users: users, success: true}
    } catch(e) {
        console.error("Error get_followings", JSON.stringify(request), e)
        return {users: [], success: false}
    }
})(request, args)
