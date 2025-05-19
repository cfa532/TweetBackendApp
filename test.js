/**
 * Given an array of ByteArray objects, set data into a fsid.
 */

((request, args)=>{
    try {
        console.log("test", JSON.stringify(request));
        return request;
    } catch(e) {
        console.error("Error test:", JSON.stringify(request), e)
    }
})(request, args);