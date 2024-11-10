((request, args)=>{
    try {
        // request, lapi are global variables
        let mid = request["mid"]
        let providers = lapi.GetVar("", "mmprovsips", mid)
        console.log("providers", providers)
        providers = JSON.parse(providers)
        let mini = null
        let ip = ""
        providers.forEach(element => {
            // iterate providers
            element.forEach(element2 => {
                // iterate IP addresses of a provider, to find the best one.
                // element2 format [183.156.208.29:1088, 3080507421]
                if (element2[1] < mini || mini == null) {
                    mini = element2[1]
                    ip = element2[0]
                }   
            });
        });
        console.log("Best provider:", ip, mid)
        return ip
    } catch(e) {
        console.error("Error get_provider:", JSON.stringify(request), e)
    }
})(request, args)