/**
 * Toggle Following Status Function
 * 
 * Entry point for the follow/unfollow API name `toggle_following`.
 * Delegates to `toggle_followed`, which contains the implementation.
 * 
 * @param {Object} request - The request object containing user and following IDs
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - ID of user initiating the follow/unfollow action
 * @param {string} request.followingid - ID of user to follow/unfollow
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    return lapi.RunMApp("toggle_followed", request, args)
})(request, args)
