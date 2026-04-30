/**
 * Legacy entry point — delegates to toggle_following, which contains the implementation.
 */
((request, args)=>{
    return lapi.RunMApp("toggle_following", request, args)
})(request, args)
