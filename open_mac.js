((request, args)=>{
    try {
        const authSid = lapi.BELoginAsAuthor()
        let fsid = lapi.MFOpenMacFile(authSid, "", request["mac"])
        return lapi.MFGetData(fsid, 0, -1)
    } catch(e) {
        console.error("Open mac file", JSON.stringify(request), e)
    }
})(request, args)