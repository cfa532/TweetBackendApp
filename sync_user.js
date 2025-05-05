((request, args)=>{
    try {
        const TWT_LIST_KEY = "list_of_tweets_mid"
        const userId = request["mid"]       // App ID assigned by Leither upon publication
        let authSid = lapi.BELoginAsAuthor()
        // if (!lapi.MFIsExist("", userId)) {
            lapi.MiMeiSync(authSid, "", userId, {})
            lapi.MiMeiProvide(authSid, "", userId)
        // }

        const mmsid = lapi.MMOpen("", userId, "last")
        lapi.Zrevrange(mmsid, TWT_LIST_KEY, 0, -1).forEach( sp => {
            const mid = sp.Member
            // if (!lapi.MFIsExist("", mid)) {
                lapi.MiMeiSync(authSid, "", mid, {})
                lapi.MiMeiProvide(authSid, "", mid)
            // }
        })
    } catch(e) {
        console.error("Error sync_user:", JSON.stringify(request), e)
    }
})(request, args)