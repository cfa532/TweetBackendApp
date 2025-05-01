((request, args)=>{
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        let authSid = lapi.BELoginAsAuthor()
        let userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, request["username"], 2, 0x07276704)
        return userId
    } catch(e) {
        console.error("Error get_userid:", JSON.stringify(request), e)
    }
})(request, args)