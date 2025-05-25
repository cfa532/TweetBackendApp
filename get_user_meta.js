((request, args) => {
    /**
     * Get bookmarks, favorites and comments list of a user.
     * All tweets should have been synced to the user's node before getting the list.
     * @param {string} type: 'comment', 'bookmark', 'favorite'
     */
    const COMMENT_LIST = 'comment_list';
    const BOOKMARK_LIST = 'bookmark_list';
    const FAVORITE_LIST = 'favorite_list';
    const userId = request['userid'];
    const appUserId = request['appuserid'];
    const pageNumber = request['pn'];
    const pageSize = request['ps'];
    const startRank = (pageNumber - 1) * pageSize;
    const endRank = pageNumber * pageSize;

    try {
        if (request['type'] === COMMENT_LIST) {
            const mmsid = lapi.MMOpen('', userId, 'last');
            return lapi.Hgetall(mmsid, COMMENT_LIST); // return list of field-value
        } else {
            return getTweets(request['type']);
        }
    } catch (e) {
        console.error('Error get_user_meta', JSON.stringify(request), e);
    }

    function getTweets(dataType) {
        const mmsid = lapi.MMOpen('', userId, 'last');
        const arr = lapi.Hgetall(mmsid, dataType)
            .sort((a, b) => b.Value - a.Value) // Sort by timestamp
            .slice(startRank, endRank)        // Slice to get only the tweets for the current page
            .map(fv => {
                const tweetId = fv.Field;
                let tweet = lapi.RunMApp('get_tweet', { aid: request.aid, ver: 'last',
                    appuserid: appUserId, tweetid: tweetId }, []);
                if (tweet == null) {
                    // Double check the tweet has been synced anyway.
                    const authSid = lapi.BELoginAsAuthor();
                    try {
                        lapi.MiMeiSync(authSid, '', tweetId, {});
                        lapi.MiMeiProvide(authSid, '', tweetId);
                        tweet = lapi.RunMApp('get_tweet', {
                            aid: request.aid,
                            ver: 'last',
                            appuserid: appUserId,
                            tweetid: tweetId
                        }, []);
                    } catch (e) {
                        console.error('Error get_user_meta sync', tweetId, e);
                    }
                }
                return tweet;
            })
            .filter(t => t); // Filter out any null tweets

        return arr;
    }
})(request, args);