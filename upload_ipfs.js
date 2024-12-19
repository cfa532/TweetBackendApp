((request, args)=>{
    /**
     * Given an array of ByteArray objects, set data into a fsid.
     */
    try {
        let authSid = lapi.BELoginAsAuthor();
        let fsid = request["fsid"]? request["fsid"] : lapi.MFOpenTempFile(authSid);
        console.log("finished=", request["finished"], request["referenceid"])
        if (request["finished"] == "true") {
            if (request["referenceid"] == undefined)
                return lapi.MFTemp2Ipfs(fsid, null)
            return lapi.MFTemp2Ipfs(fsid, request["referenceid"])
        }
        let offset = parseInt(request["offset"], 10)
        let b = new Uint8Array(args[0])         // key point.
        let count = lapi.MFSetData(fsid, b, offset);
        console.log("count=", count, offset)
        return fsid;
    } catch(e) {
        console.error("Error upload_ipfs:", JSON.stringify(request), e)
    }
})(request, args);