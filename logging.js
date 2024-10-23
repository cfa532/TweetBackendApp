((request, args)=>{
    // request, lapi are global variables
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const msg = request["msg"]
        console.log("Timber log", msg)

    } catch(e) {
        console.error(e)
    }
})(request, args)