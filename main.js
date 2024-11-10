((request, args)=>{
    // request, lapi are global variables
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        // let APP_MARK = "στηναρχή"
        let url = request["url"]
        let addr = lapi.GetVar("", "domainaddr", url)
        return {appId: request["aid"], addr: addr}
    } catch(e) {
        console.error("Error main", JSON.stringify(request), e)
    }
})(request, args)