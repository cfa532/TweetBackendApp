/**
 * Given mid of a shared file, find its sole provider and 
 */
((request, args)=>{
    try {
        const ips = lapi.GetVar("", "mmprovsips", request["mid"])
        if (!ips) return null
        const providers = JSON.parse(ips)
        if (!providers || !Array.isArray(providers)) return null
        let ip = ""
        let mini = null
        providers.forEach(element => {
            element.forEach(element2 => {
                // iterate IP addresses of a provider, to find the best one.
                // element2 format [183.156.208.29:1088, 3080507421]
                if (element2[1] < mini || mini === null) {
                    mini = element2[1]
                    ip = element2[0]
                }
            })
        });
        console.log(ips, ip)
        return ip
    } catch(e) {
        console.error("Error get_shared_file_ip", JSON.stringify(request), e)
    }
})(request, args)