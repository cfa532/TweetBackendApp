((request, args)=>{
    try {
        // Used only by tweet web.
        let mid = request["mid"]
        let providers = lapi.GetVar("", "mmprovsips", mid)
        console.log("providers", providers)
        providers = JSON.parse(providers)
        let mini = null
        let ip = ""
        let ips = []
        providers.forEach(element => {
            // iterate providers
            console.log("element", JSON.stringify(element))
            ips.concat(element.forEach(element2 => {
                console.log("element2", JSON.stringify(element2))
                // iterate IP addresses of a provider, to find the best one.
                // element2 format [183.156.208.29:1088, 3080507421]
                // if (element2[1] < mini || mini == null) {
                //     mini = element2[1]
                //     ip = element2[0]
                // }
                ips.push(element2[0])
            }))
        });
        console.log("IP addresses for", mid, JSON.stringify(ips))
        return ips
    } catch(e) {
        console.error("Error get_provider:", JSON.stringify(request), e)
    }
})(request, args)