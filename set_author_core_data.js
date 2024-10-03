((request, args)=>{
    const OWNER_DATA_KEY = "data_of_author"
    
    // request, lapi are global variables. so are aid, ver
    console.log("set userdata", request["user"])
    let user = JSON.parse(request["user"])
    const authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, user.mid, "cur")
    lapi.Set(mmsid, OWNER_DATA_KEY, user)
    lapi.MMBackup(authSid, user.mid, "")
    lapi.MiMeiPublish(authSid, "", user.mid)
})(request, args)