((request, args)=>{
        // request, lapi are global variables
        try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        let APP_MARK = "στηναρχή"
        let url = request["url"]
        let addr = lapi.GetVar("", "domainaddr", url)

        console.log("app id, ", request["mid"], url, APP_ID)

        return {appId: request["mid"], addr: addr}
    } catch(e) {
        console.error(e)
    }
})(request, args)