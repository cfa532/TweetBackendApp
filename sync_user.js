((request, args)=>{
    try {
        const userId = request["mid"]       // App ID assigned by Leither upon publication
        let authSid = lapi.BELoginAsAuthor()
        lapi.MiMeiSync(authSid, "", userId, {})
        lapi.MiMeiProvide(authSid, "", userId)
    } catch(e) {
        console.error("Error sync_user:", JSON.stringify(request), e)
    }
})(request, args)