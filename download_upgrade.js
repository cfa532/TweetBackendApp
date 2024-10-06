((request, args) => {
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const APP_MARK = "package upgrade download"

        // get mid of upgrade app package.
        let authSid = lapi.BELoginAsAuthor()
        let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 1, 0x07276704)
        let ip = lapi.RunMApp("get_provider", {aid: request["aid"], ver: "last", mid: mid}, [])
        return mid.length>27 ? "http://"+ip+"/ipfs/"+mid : "http://"+ip+"/mm/"+mid
    } catch(e) {
        console.error(e)
    }
})(request, args)