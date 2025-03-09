((request, args)=>{
    /**
     * Update the last login time of the user.
     * Usually called after successful login on node other than the writable host.
     */
    try {
        const OWNER_DATA_KEY = "data_of_author"

        let authSid = lapi.BELoginAsAuthor()
        let userId = request["userid"]
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)

        user["lastLogin"] = Date.now()
        lapi.Set(mmsid, OWNER_DATA_KEY, user)
        lapi.MMBackup(authSid, user.mid, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", user.mid)
        console.log("User last login updated.", user.mid, user.lastLogin)
    } catch(e) {
        console.error("Error update_login_time:", JSON.stringify(request), e)
    }
})(request, args);