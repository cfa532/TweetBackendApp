((request, args)=>{
    try {
        /**
         * Given a user's ID and attaches the new file mid to it. The new file is IPFS,
         * assign its cid to a MimeiID and return it.
         */
        const userId = request["userid"]

        let authSid = lapi.BELoginAsAuthor()
        lapi.MMOpen(authSid, userId, "cur")
        lapi.MMAddRef(authSid, userId, request["cid"])
        lapi.MMBackup(authSid, userId, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userId)

        console.log("Attached to user a file mid=", userId)
    } catch(e) {
        console.error("upload_package error:", e)
    }
})(request, args);