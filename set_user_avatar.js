((request, args)=>{

    const OWNER_DATA_KEY = "data_of_author"
    const authSid = lapi.BELoginAsAuthor()
    let mmsid = lapi.MMOpen(authSid, request["userid"], "cur")
    let user = lapi.Get(mmsid, OWNER_DATA_KEY)
    user["avatar"] = request["avatar"]
    lapi.Set(mmsid, OWNER_DATA_KEY, user)
    lapi.MMBackup(authSid, user.mid, "")
    console.log("set user avatar", JSON.stringify(user))
})(request, args)