((request, args)=>{
    try {
        const userId = request["mid"]       // App ID assigned by Leither upon publication
        const authSid = lapi.BELoginAsAuthor()
        lapi.MiMeiSync(authSid, "", userId, {})
    } catch(e) {
        console.error("Error sync_user:", JSON.stringify(request), e)
    }
})(request, args)