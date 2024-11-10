((request, args)=>{
    try {
        let authSid = lapi.BELoginAsAuthor()
        let fsid = lapi.MFOpenTempFile(authSid);
        return fsid
    } catch(e) {
        console.error("Error open_temp_file", JSON.stringify(request), e)
    }
})(request, args)