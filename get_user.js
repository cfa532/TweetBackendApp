/**
 * Given a mimei Id, return an object of user's data if it's in local DB,
 * otherwise return an IP address of a provider that has the least response time.
 */
((request, args)=>{
    try {
        const userId = request["userid"]

        // try to get the user's data from local node
        const user = lapi.RunMApp("get_user_core_data", {aid: request.aid, ver:"last",
            userid: userId}, [])
        if (user) {
            return user
        } else {
            const ip = lapi.RunMApp("get_provider", {aid: request.aid, ver:"last",
                mid: userId}, [])
            console.log("get_user: new ip", ip)
            return ip
        }
    } catch(e) {
        console.error("Error get_user:", e, JSON.stringify(request))
    }
})(request, args)