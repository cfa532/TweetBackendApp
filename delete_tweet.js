(()=>{
    const TWT_LIST_KEY = "list_of_tweets_mid"

    let tweetId = request["tweetid"]    // tweet Id to be removed
    let authorMid = request["authorid"]

    const authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, authorMid, "cur")
    lapi.Zrem(mmsid, TWT_LIST_KEY, tweetId)
    lapi.MMBackup(authSid, authorMid, "", "delref=true")
    lapi.MMDelRef(authSid, authorMid, tweetId)

    mmsid = lapi.MMOpen(authSid, tweetId, "cur")
    lapi.MMDelVers(mmsid, tweetId)
    lapi.MMBackup(authSid, tweetId, "", "delref=true")
    console.log("Delete tweet ", tweetId)
    return tweetId
    // lapi.MiMeiPublish(authSid, "", authorMid)
})()