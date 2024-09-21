(()=>{
    let authSid = lapi.BELoginAsAuthor()
    let fsid = lapi.MFOpenTempFile(authSid);
    console.log("fsid=", fsid)
    return fsid
})()