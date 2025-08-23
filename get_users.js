/**
 * Given a list of userIds, return a list of user objects.
 */

((request, args)=>{
    const userIds = request["userids"]
    const users = userIds.map(userId => {
        return lapi.RunMApp("get_user_core_data", {aid: request["aid"], ver:"last",
            userid: userId}, [])
    })
    return users
})