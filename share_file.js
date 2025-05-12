((request, args)=>{
    const APP_ID = request["aid"]
    const APP_EXT = "com.example.twitterclone"
    const USER_SHARE_MID = "shared_mid_of_user"
    const userId = request["userid"]

    try {
        const user = getUser(userId)
        const file = JSON.parse(request["file"])    // file path on user's hard drive that is being shared.
        const nodeId = lapi.GetVar("", "hostid")
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        if (user.hostIds?.findIndex(id => id == nodeId) != 0) {
            return lapi.RunMApp("share_file", {aid: APP_ID, ver: "last",
                nid: user.hostIds[0], sid: systemSid,
                userid: userId}, []
            )
        } else {
            const authSid = lapi.BELoginAsAuthor()
            const mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, file.path, 1, 0x07276704)
            const userSid = lapi.MMOpen(authSid, userId, "cur")

            // if the mid exists, it has been shared, just return it.
            const sharedObj = lapi.Hget(userSid, USER_SHARE_MID, mid)
            if (sharedObj) {
                return mid
            }

            const fsid = lapi.MMOpen(authSid, mid, "cur")
            lapi.MFSetObject(fsid, {
                userId: userId,
                path: file.path,
                name: file.name,
                size: file.size,
                isDirectory: file.isDirectory,
                modified: file.modified   // time of sharing
            })
            lapi.MMBackup(fsid, mid, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", mid)
            console.log("shared mid", mid)
    
            lapi.Hset(userSid, USER_SHARE_MID, mid, {
                downloadCount: 0,   // how many times the file has been downloaded
                authorizedFor: null,    // anybody can see it
                validTime: 0,   // Days of sharing. 0 means forever
                modified: Date.now()   // time of sharing
            })
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(authSid, "", userId)
    
            return mid
        }
    } catch(e) {
        console.error("Error share_file", JSON.stringify(request), e)
    }

    function getUser(mid) {
        const OWNER_DATA_KEY = "data_of_author"
        const mmsid = lapi.MMOpen("", mid, "last")
        return lapi.Get(mmsid, OWNER_DATA_KEY)
    }
})(request, args)