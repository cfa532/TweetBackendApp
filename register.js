/**
 * New user registration
 */
((request, args)=>{
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"    
    const OWNER_DATA_KEY = "data_of_author"
    const user = JSON.parse(request["user"])
    const followings = JSON.parse(request["followings"])
    const nodeId = lapi.GetVar("", "hostid")
    console.log("nodeId", nodeId, JSON.stringify(request))

    try {
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
    
            // result of GetVar is a string literal "[]", we need to parse it to an array.
            const userProvs = JSON.parse(lapi.GetVar("", "mmprovsips", userMid))
            if (userProvs.length > 0) {
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
    
            followings?.forEach(mid => {
                try {
                    // find the host of the otherId. Assume it is available on this node.
                    // otherwise, the returned value will be the IP address of the otherId.
                    const otherUser = lapi.RunMApp("get_user", {aid: APP_ID, ver: "last",
                        userid: mid}, [])
                    console.log("Following otherUser", JSON.stringify(otherUser))
                    lapi.RunMApp("toggle_following", {aid: APP_ID, ver: "last",
                        userid: user.mid, otherid: mid, otherhostid: otherUser.hostIds[0]
                    }, [])
                } catch(e) {
                    console.error("Error in register when toggle_following", e, JSON.stringify(request))
                }
            });
    
            // lapi.RunMApp("update_app_data", {aid: APP_ID, ver: "last", user: JSON.stringify(user)}, [])
            console.log("User regisgtered.", JSON.stringify(user))
            delete user.password
            return {user: JSON.stringify(user), status: "success"}
        }
    } catch(e) {
        console.error("Error register", JSON.stringify(request), e)
    }
})(request, args)
