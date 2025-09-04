/**
 * Given an array of ByteArray objects, set data into a fsid.
 */

((request, args)=>{
    try {
        let authSid = lapi.BELoginAsAuthor();
        let fsid = request["fsid"]? request["fsid"] : lapi.MFOpenTempFile(authSid);
        if (request["finished"] == "true") {
            if (request["referenceid"] == undefined) {
                // no ref to add, this is an attachment of a tweet.
                // It will be add as ref to the tweetId later.
                return lapi.MFTemp2Ipfs(fsid, null)
            }
            // add new ipfs as ref to a parent Mimei, usually an userId
            return lapi.MFTemp2Ipfs(fsid, request["referenceid"])
        }
        let offset = parseInt(request["offset"], 10)
        let b = new Uint8Array(args[0])         // key point.
        lapi.MFSetData(fsid, b, offset);
        return fsid;
    } catch(e) {
        console.error("Error upload_ipfs:", JSON.stringify(request), e)
    }
})(request, args);