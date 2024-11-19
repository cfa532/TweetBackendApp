((request, args)=>{
    try {
        // given a cid, assign a Mimei Id to it.
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const APP_MARK = "package upgrade download"
        let authSid = lapi.BELoginAsAuthor()
        let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 1, 0x07276704)
        lapi.MFSetCid(authSid, mid, request["cid"])
        lapi.MiMeiPublish(authSid, "", mid)
        console.log("upload_package to mid=", mid)
        return mid
    } catch(e) {
        console.error("upload_package error:", e)
    }
})(request, args);