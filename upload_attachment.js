((request, args)=>{
    try {
        // given a cid, assign a Mimei Id to it.
        const adminId = request["userid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const APP_MARK = request["filename"]
        console.log("upload file", adminId, APP_MARK)

        let authSid = lapi.BELoginAsAuthor()
        let mid = lapi.MMCreate(authSid, adminId, APP_EXT, APP_MARK, 1, 0x07276704)
        lapi.MFSetCid(authSid, mid, request["cid"])

        lapi.MMOpen(authSid, adminId, "cur")
        lapi.MMAddRef(authSid, adminId, mid)
        lapi.MMBackup(authSid, adminId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", mid)
        lapi.MiMeiPublish(authSid, "", adminId)

        console.log("upload_package to mid=", mid)
        return mid
    } catch(e) {
        console.error("upload_package error:", e)
    }
})(request, args);