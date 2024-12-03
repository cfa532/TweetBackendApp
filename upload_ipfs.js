((request, args)=>{
    /**
     * Given an array of ByteArray objects, set data into a fsid.
     */
    let authSid = lapi.BELoginAsAuthor();
    let fsid = request["fsid"]? request["fsid"] : lapi.MFOpenTempFile(authSid);
    let offset = parseInt(request["offset"], 10)
    let b = new Uint8Array(args[0])         // key point.
    count = lapi.MFSetData(fsid, b, offset);
    console.log("count=", count, offset)
    return fsid;

    // function readSlice(fsid, buf, offset) {
    //     let end, count;
    //     while (offset < buf.length) {
    //         end = Math.min(offset + chunkSize, buf.length);
    //         try {
    //             let b = new Uint8Array(buf.slice(offset, end))  // key point.
    //             count = lapi.MFSetData(fsid, b, offset);
    //         } catch (error) {
    //             console.error("Error in MFSetData:", error);
    //             return;
    //         }
    //         offset += count;
    //     }
    //     try {
    //         return lapi.MFTemp2Ipfs(fsid, ref);
    //     } catch (error) {
    //         console.error("Error in MFTemp2Ipfs:", error);
    //     }
    // }
})(request, args);