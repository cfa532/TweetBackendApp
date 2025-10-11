/**
 * New user registration
 */
((request, args)=>{
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"    
    const OWNER_DATA_KEY = "data_of_author"
    const user = JSON.parse(request["user"])
    const nodeId = lapi.GetVar("", "hostid")

    try {
        if (user.hostIds?.length > 0 && user.hostIds[0] !== nodeId) {
            // register it on remote host
            const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
            const remoteParams = {
                aid: APP_ID, 
                ver: "last",
                nid: user.hostIds[0], 
                sid: systemSid, 
                user: request["user"]
            }
            return lapi.RunMApp("register", remoteParams, [])
        } else {
            // register it on current node
            const authSid = lapi.BELoginAsAuthor()
            const userMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.username, 2, 0x07276704)
    
            // result of GetVar is a string literal "[]", we need to parse it to an array.
            const userProvs = lapi.RunMApp("get_provider_ip", {aid: APP_ID, ver: "last",
                mid: userMid}, [])
            if (userProvs) {
                console.warn("User register failed. Existing user", JSON.stringify(userProvs))
                return {status: "failure", reason: "Username is taken"}
            }
            user["mid"] = userMid
            user["password"] = lapi.MMCreate(authSid, APP_ID, APP_EXT, user.password, 1, 0x07276704)
            user["timestamp"] = Date.now()
            if (!user["hostIds"] || user["hostIds"].length < 1) {
                user["hostIds"] = [nodeId]
            }
            const userSid = lapi.MMOpen(authSid, userMid, "cur")
            lapi.Set(userSid, OWNER_DATA_KEY, user)      // create default user data area
            lapi.MMBackup(userSid, userMid, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userMid)     // otherwise toggle_following won't find the new user.
    
            // lapi.RunMApp("update_app_data", {aid: APP_ID, ver: "last", user: JSON.stringify(user)}, [])
            console.log("User regisgtered.", JSON.stringify(user))
            delete user.password
            return {user: JSON.stringify(user), status: "success"}
        }
    } catch(e) {
        console.error("Error register", JSON.stringify(request), e)
        return {status: "failure", reason: e.message || String(e)}
    }
})(request, args)
