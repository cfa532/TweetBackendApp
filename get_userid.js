((request, args)=>{
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"
    let APP_MARK = request["phrase"]

    let authSid = lapi.BELoginAsAuthor()
    let userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 2, 0x07276704)
    
    console.log("Get userid=", userId)
    return userId
})(request, args)