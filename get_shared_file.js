/**
 * Given mid of a shared file, get its content
 */
((request, args)=>{
    try {
        const mmsid = lapi.MMOpen("", request["mid"], "last")
        const file = lapi.MFGetObject(mmsid)
        return file
    } catch(e) {
        console.error("Error get_shared_file", JSON.stringify(request), e)
    }
})(request, args)