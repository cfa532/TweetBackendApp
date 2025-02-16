((request, args)=>{
    try {
        const OWNER_DATA_KEY = "data_of_author"
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const authSid = lapi.BELoginAsAuthor()
        let user = JSON.parse(request["user"])
        const mmsid = lapi.MMOpen(authSid, user.mid, "cur")
        let userInDB = lapi.Get(mmsid, OWNER_DATA_KEY)
        /**
         * When user update without providing password, keep the old one.
         */
        if (user.password) {
            user.password = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)
        } else {
            user.password = userInDB.password
        }

        lapi.Set(mmsid, OWNER_DATA_KEY, user)
        lapi.MMBackup(authSid, user.mid, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", user.mid)

        // check if writable node Id is changed. Call sync user on the new node if true.
        // if (oldUserData["hostIds"][0] !== user["hostIds"][0]) {
        // }
        // In reality, copy of user data on each node should be in sync.
        
        delete user.password
        return {user: JSON.stringify(user), status: "success"}
    } catch(e) {
        console.error("Error set_auth_core_data", JSON.stringify(request), e)
        return {status: "failure", reason: "Update failed"}
    }
})(request, args)