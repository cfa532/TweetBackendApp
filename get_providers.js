/**
 * Given a mimei Id, return a list of IP addresses of providers
 */
((request, args)=>{
    try {
        let mid = request["mid"]
        let providers = lapi.GetVar("", "mmprovsips", mid)
        providers = JSON.parse(providers)
        let ips = []
        providers.forEach(element => {
            // iterate providers
            element.forEach(element2 => {
                // iterate IP addresses of a provider, to find the best one.
                // element2 format [183.156.208.29:1088, 3080507421]
                // if (element2[1] < mini || mini == null) {
                //     mini = element2[1]
                //     ip = element2[0]
                // }
                ips.push(element2[0])
            })
        });
        return ips
    } catch(e) {
        console.error("Error get_provider:", JSON.stringify(request), e)
    }
})(request, args)