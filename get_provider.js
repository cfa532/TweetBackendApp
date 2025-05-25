/**
 * Given a mimei Id, return a list of IP addresses of providers
 */
((request, args)=>{
    const mid = request["mid"]
    const providers = JSON.parse(lapi.GetVar("", "mmprovsips", mid))
    try {
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
        return ip
    } catch(e) {
        console.error("Error get_provider:", e, JSON.stringify(request), JSON.stringify(providers))
    }
})(request, args)