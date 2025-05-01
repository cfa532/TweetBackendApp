((request, args)=>{
    function toggleUserMeta(
        mid, userId, type, appId
    ) {
        try {
            const OWNER_DATA_KEY = "data_of_author"
            const COMMENT_LIST = "comment_list"
            const BOOKMARK_LIST = "bookmark_list"
            const FAVORITE_LIST = "favorite_list"
    
            // mimeiId of a tweet that is bookmarked or favored,
            // or comment made by the userId
            var authSid = lapi.BELoginAsAuthor()
            let userSid = lapi.MMOpen(authSid, userId, "cur")
            let user = lapi.Get(userSid, OWNER_DATA_KEY)
            
            if (type == "comment") {
                // add new comment to User's comment list
                lapi.Hset(userSid, COMMENT_LIST, mid, Date.now())
            } else if (type == "bookmark") {
                // Check if the user has already bookmarked the tweet,
                // or favorited the tweet, or commented on the tweet
                let hasValue = lapi.Hget(userSid, BOOKMARK_LIST, mid) ? true : false
                if (hasValue) {
                    lapi.Hdel(userSid, BOOKMARK_LIST, mid)
                } 
                else {
                    lapi.Hset(userSid, BOOKMARK_LIST, mid, Date.now())
                }
            } else if (type == "favorite") {
                let hasValue = lapi.Hget(userSid, FAVORITE_LIST, mid) ? true : false
                if (hasValue) {
                    lapi.Hdel(userSid, FAVORITE_LIST, mid)
                } 
                else {
                    lapi.Hset(userSid, FAVORITE_LIST, mid, Date.now())
                }
            }
            // update the score of the user in AppData
            lapi.RunMApp("node_update_score", {aid: appId, ver:"last",
                userid: userId, mid: userId}, [])
            lapi.MMBackup(userSid, userId, "", "delref=true")
            lapi.MiMeiPublish(userSid, "", userId)

            return {user: user, hasValue: hasValue ? false : true}
        } catch(e) {
            console.error("Error toggle_meta_by_user_host", JSON.stringify(request), e)
        }
    }

    const APP_ID = request["aid"]
    const userId = request["userid"]
    const hostId = request["hostid"]
    // tweetID that appUser bookmarked or favored, or commentId made by the appUser
    const tweetId = request["mid"]
    const operationType = request["type"]

    let nodeId = lapi.GetVar("", "hostid")    // current node id
    if (nodeId != hostId) {
        // send the request to the remote host.
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)
        const req = {aid: APP_ID, ver: "last", nid: hostId, sid: systemSid,
            userid: userId, mid: tweetId, type: operationType}
        let ret = lapi.RunMApp("toggle_meta_by_user", req, [])
        console.log("Toggle user meta remote ret=", JSON.stringify(ret))

        // provide or unprovide the tweet object
        if (operationType == "bookmark" || operationType == "favorite") {
            if (ret.hasValue) {
                try {
                    if (!lapi.MFIsExist("", tweetId)) {
                        lapi.MiMeiSync(systemSid, "", tweetId, {})
                        lapi.MiMeiProvide(systemSid, "", tweetId)
                    }
                } catch(e) {
                    console.error("toggle_meta_by_user Error provide tweet", e, JSON.stringify(ret))
                }
            } else {
                // someone else might providing them.
                // lapi.MiMeiUnprovide(systemSid, "", tweetId)
                // lapi.MMDelVers(systemSid, tweetId)
            }
        }
        // user local data will be updated by Leither
        return ret
    } else {
        let ret = toggleUserMeta(tweetId, userId, operationType, APP_ID)
        console.log("toggle_meta_by_user ret=", JSON.stringify(ret))
        return ret
    }

})(request, args)