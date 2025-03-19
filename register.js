/**
 * New user registration
 */
((request, args)=>{
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"    
    const OWNER_DATA_KEY = "data_of_author"
    const FOLLOWINGS_LIST = "list_of_followings_mid"
    const user = JSON.parse(request["user"])

    try {
        const nodeId = lapi.GetVar("", "hostid")
        console.log("nodeId", nodeId, request["user"])
        if (user.hostIds?.length > 0 && user.hostIds[0] != nodeId) {
            // register it on remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            return lapi.RunMApp("register", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid, user: request["user"]}, []
            )
        } else {
            // register it on current node
            const authSid = lapi.BELoginAsAuthor()
            const userMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.username, 2, 0x07276704)
            const userSid = lapi.MMOpen(authSid, userMid, "cur")
    
            if (lapi.Get(userSid, OWNER_DATA_KEY)) {
                console.warn("User register failed. Existing user", userMid)
                // return {status: "failure", reason: "Username is taken"}
            }
            user["mid"] = userMid
            user["password"] = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)
            user["timestamp"] = user["timestamp"] ? user["timestamp"] : Date.now()
            lapi.Set(userSid, OWNER_DATA_KEY, user)      // create default user data area
    
            user["followingList"]?.forEach(mid => {
                lapi.Hset(userSid, FOLLOWINGS_LIST, mid, Date.now())
            });
            lapi.MMBackup(userSid, userMid, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userMid)
    
            // lapi.RunMApp("update_app_data", {aid: APP_ID, ver: "last", user: JSON.stringify(user)}, [])
            console.log("User regisgtered.", JSON.stringify(user))
            delete user.password
            return {user: JSON.stringify(user), status: "success"}
        }
    } catch(e) {
        console.error("Error register", JSON.stringify(request), e)
    }
})(request, args)