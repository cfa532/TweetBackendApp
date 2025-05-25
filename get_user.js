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
            // if not found, try to get the user's data from remote DB
            const providers = JSON.parse(lapi.GetVar("", "mmprovsips", userId))
            let ip = "", mini = null
            providers.forEach(element => {
                // iterate providers
                element.forEach(element2 => {
                    // iterate IP addresses of a provider, to find the best one.
                    // element2 format [183.156.208.29:1088, 3080507421]
                    const parts = element2[0].split(":")
                    const port = parseInt(parts[parts.length - 1])
                    /**
                     * Filter out the IP addresses that are not in the range of 8000-9000
                     * which might be wrong port number reported by IPFS.
                     */
                    if (port <8000 || port > 9000) {
                        return
                    }
                    if (element2[1] < mini || mini == null) {
                        mini = element2[1]
                        ip = element2[0]
                    }
                })
            });
            console.log("get_user: new ip", ip)
            return ip
        }
    } catch(e) {
        console.error("Error get_user:", JSON.stringify(request), e)
    }
})(request, args)