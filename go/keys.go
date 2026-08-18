// keys.go — request parameter names, Mimei database keys and object constants.
//
// The key strings are part of the on-disk format: existing nodes already hold
// data written by the JavaScript implementation, so these values must match it
// exactly. Several logical lists live under different key names depending on
// which object they hang off, and those are named apart here rather than reused.
package lapp

// Request parameter names injected by the node, mirroring lapi's Request_*
// constants. They are repeated as plain strings so this file stays the single
// place to look up a parameter name.
const (
	reqAppID   = "aid"
	reqAppVer  = "ver"
	reqEntry   = "entry"
	reqSid     = "sid"
	reqNodeID  = "nid"
	reqMID     = "mid"
	reqMMRoot  = "mmroot"
	reqVersion = "version"
)

// Application identity.
const (
	// appExt tags Mimei objects created for user accounts and content.
	appExt = "com.example.twitterclone"
	// appExtMessage tags the messaging Mimei, which uses its own extension.
	appExtMessage = "us.fireshare.tweet"
)

// Keys inside a user's Mimei database.
const (
	// ownerDataKey holds the user object itself.
	ownerDataKey = "data_of_author"
	// userTweetList is a sorted set of the user's own tweet ids, scored by time.
	userTweetList = "list_of_tweets_mid"
	// userFollowingsList maps followed user id -> metadata.
	userFollowingsList = "list_of_followings_mid"
	// userFollowersList maps follower user id -> metadata.
	userFollowersList = "list_of_followers_mid"
	// userCommentList maps comment id -> parent tweet id for comments the user wrote.
	userCommentList = "comment_list"
	// userBookmarkList maps bookmarked tweet id -> metadata.
	userBookmarkList = "bookmark_list"
	// userFavoriteList maps favorited tweet id -> metadata.
	userFavoriteList = "favorite_list"
	// userPinnedTweets is the ordered list of tweets the user pinned.
	userPinnedTweets = "pinned_tweet_list"
	// userBlockedUsers maps blocked user id -> metadata.
	userBlockedUsers = "blocked_users"
	// userFollowingsTweets caches the timeline assembled from followed users.
	userFollowingsTweets = "followings_tweets"
	// userFailedFollowingAccesses records followed users whose node could not be
	// reached, so repeated failures can be pruned.
	userFailedFollowingAccesses = "failed_following_accesses"
	// userShareMid points at the Mimei holding the user's shared files.
	userShareMid = "shared_mid_of_user"
	// userMessageMimei points at the user's message Mimei.
	userMessageMimei = "message_mimei_1"
	// userLastFetchMsg marks how far the user has read their messages.
	userLastFetchMsg = "read_message_indicator"
	// userLastIncomingMsg marks the newest message delivered to the user.
	userLastIncomingMsg = "incoming_message_indicator"
)

// Keys inside a tweet's Mimei database. A comment is itself a tweet object and
// uses the same keys.
const (
	// tweetContentKey holds the tweet object.
	tweetContentKey = "core_data_of_tweet"
	// tweetCommentList maps comment id -> author id for this tweet's direct children.
	tweetCommentList = "comment_list_key"
	// tweetLikeList maps user id -> metadata for users who favorited the tweet.
	tweetLikeList = "tweet_like_list"
	// tweetBookmarkList maps user id -> metadata for users who bookmarked the tweet.
	tweetBookmarkList = "tweet_bookmark_list"
	// tweetRetweetList maps retweeting user id -> retweet id.
	tweetRetweetList = "tweet_retweet_list"
)

// Mimei object types passed to MMCreate.
const (
	// mimeiTypeFile creates a content-addressed object; creating one from a
	// value yields a stable id for that value, which is how passwords are
	// hashed without storing them.
	mimeiTypeFile byte = 1
	// mimeiTypeDatabase creates a key/value database object.
	mimeiTypeDatabase byte = 2
)

// Permission masks used when creating Mimei objects.
const (
	// rightUserObject is used for user accounts and their content.
	rightUserObject uint64 = 0x07276704
	// rightAppData is used for application-owned data areas.
	rightAppData uint64 = 0x07276705
)

// Mimei versions. Writes go to "cur"; reads go to "last", the most recent
// backup. Mixing them up either reads a stale value or writes somewhere no
// reader will look.
const (
	verCur  = "cur"
	verLast = "last"
)

// API response versions understood by the clients.
const (
	versionV2 = "v2"
	versionV3 = "v3"
)
