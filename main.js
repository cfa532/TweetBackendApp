((request, args)=>{
    // request, lapi are global variables
    const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
    const APP_EXT = "com.example.twitterclone"
    let APP_MARK = "στηναρχή"

    let keyPhrase = request["phrase"]
    if (keyPhrase) APP_MARK = keyPhrase
    
    let authSid = lapi.BELoginAsAuthor()
    let creatorMid = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 2, 0x07276704)
    lapi.MiMeiPublish(authSid, "", creatorMid)
    console.log("app id, ", creatorMid, request["aid"])
    return {appId: request["mid"] || request["aid"], alphaId: creatorMid}
})(request, args)