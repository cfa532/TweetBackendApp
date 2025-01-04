((request, args) => {
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const APP_MARK = "package upgrade download"
        let authSid = lapi.BELoginAsAuthor()

        // get mid of upgrade app package. 9OCLYP-SXzen3e171-Ei_6N3Gwl
        let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 1, 0x07276704)
        // let ip = lapi.RunMApp("get_provider", {aid: request["aid"], ver: "last", mid: mid}, [])
        // console.log("Upgrade package mid", mid, ip)
        // return mid.length>27 ? "http://"+ip+"/ipfs/"+mid : "http://"+ip+"/mm/"+mid
        console.log("Upgrade package mid", mid)
        return mid
    } catch(e) {
        console.error("Error download_upgrade", JSON.stringify(request), e)
    }
})(request, args)