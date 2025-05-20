/**
 * Given a mimei Id, return a list of IP addresses of providers
 */
((request, args)=>{
    try {
        let mid = request["mid"]
        let providers = lapi.GetVar("", "mmprovsips", mid)
        console.log("providers", providers)
        providers = JSON.parse(providers)
        let ip, mini = null
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
        return ip
    } catch(e) {
        console.error("Error get_provider:", JSON.stringify(request), e)
    }
})(request, args)