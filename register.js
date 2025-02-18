((request, args)=>{
    try {
        // user registration
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"    
        const OWNER_DATA_KEY = "data_of_author"
        const FOLLOWINGS_LIST = "list_of_followings_mid"

        let authSid = lapi.BELoginAsAuthor()
        let user = JSON.parse(request["user"])
        userMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.username, 2, 0x07276704)
        let mmsid = lapi.MMOpen(authSid, userMid, "cur")

        if (lapi.Get(mmsid, OWNER_DATA_KEY)) {
            console.warn("User register failed. Existing user", userMid)
            return {status: "failure", reason: "Username is taken"}
        }
        user["mid"] = userMid
        user["password"] = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)
        lapi.Set(mmsid, OWNER_DATA_KEY, user)      // create default user data area

        user["followingList"]?.forEach(mid => {
            lapi.Hset(mmsid, FOLLOWINGS_LIST, mid, Date.now())
        });
        lapi.MMBackup(authSid, userMid, "", "delref=true")
        lapi.MiMeiPublish(authSid, "", userMid)

        // lapi.RunMApp("update_app_data", {aid: APP_ID, ver: "last", user: JSON.stringify(user)}, [])
        console.log("User regisgtered.", JSON.stringify(user))
        delete user.password
        return {user: JSON.stringify(user), status: "success"}
    } catch(e) {
        console.error("Error register", JSON.stringify(request), e)
    }
})(request, args)