((request, args)=>{
    let userId = request["userid"];
    let chunkSize = 1024*1024*5; // 5MB
    console.log("upload ipfs", args.length)
    let authSid = lapi.BELoginAsAuthor();
    let fsid = lapi.MFOpenTempFile(authSid);
    let cid = readSlice(fsid, args[0], 0);
    if (cid) {
        console.log("IPFS cid=", cid);
    } else {
        console.error("Failed to get IPFS cid");
    }
    return cid;

    function readSlice(fsid, buf, offset) {
        let end, count;
        while (offset < buf.length) {
            end = Math.min(offset + chunkSize, buf.length);
            try {
                count = lapi.MFSetData(fsid, buf.slice(offset, end), offset);
            } catch (error) {
                console.error("Error in MFSetData:", error);
                return;
            }
            offset += count;
        }
        try {
            return lapi.MFTemp2Ipfs(fsid, userId);
        } catch (error) {
            console.error("Error in MFTemp2Ipfs:", error);
        }
    }
})(request, args);