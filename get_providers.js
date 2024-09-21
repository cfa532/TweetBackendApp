(()=>{
    // request, lapi are global variables
    let userId = request["userid"]
    let providers = lapi.GetVar("", "mmprovsips", userId)
    console.log(providers)
    return providers
})()