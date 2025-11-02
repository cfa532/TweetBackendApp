# TweetBackendApp Server API Documentation

This document describes all endpoints available in the TweetBackendApp server, including their expected inputs and output data schemas.

## Authentication Endpoints

### Login
**Endpoint:** `login`

**Input Parameters:**
- `aid` (string): App ID assigned by Leither upon publication
- `username` (string): User's username
- `password` (string): User's password

**Output Schema:**
```json
{
  "user": {
    "mid": "string",
    "username": "string",
    "hostIds": ["string"],
    "lastLogin": "number",
    "avatar": "string",
    "timestamp": "number"
  },
  "status": "success"
}
```

**Error Response:**
```json
{
  "status": "failure",
  "reason": "Wrong password" | "Unknown error"
}
```

### Register
**Endpoint:** `register`

**Input Parameters:**
- `aid` (string): App ID assigned by Leither upon publication
- `user` (string): JSON string containing user object
- `followings` (string): JSON string containing array of user IDs to follow

**User Object Schema:**
```json
{
  "username": "string",
  "password": "string",
  "hostIds": ["string"],
  "timestamp": "number"
}
```

**Output Schema:**
```json
{
  "user": "string", // JSON string of user object (password removed)
  "status": "success"
}
```

**Error Response:**
```json
{
  "status": "failure",
  "reason": "Username is taken"
}
```

## User Management Endpoints

### Get User
**Endpoint:** `get_user`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User's Mimei ID

**Output Schema:**
```json
{
  "mid": "string",
  "username": "string",
  "hostIds": ["string"],
  "avatar": "string",
  "timestamp": "number"
}
```

### Get User Core Data
**Endpoint:** `get_user_core_data`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User's Mimei ID

**Output Schema:** Same as Get User

### Get User Meta
**Endpoint:** `get_user_meta`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User's Mimei ID

**Output Schema:** User metadata object

### Set User Avatar
**Endpoint:** `set_user_avatar`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User's Mimei ID
- `avatar` (string): Avatar data/URL

**Output Schema:** No specific return value

### Set Author Core Data
**Endpoint:** `set_author_core_data`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User's Mimei ID
- `data` (string): JSON string of user data

**Output Schema:** No specific return value

### Get User ID
**Endpoint:** `get_userid`

**Input Parameters:**
- `aid` (string): App ID
- `username` (string): Username to lookup

**Output Schema:**
```json
{
  "userid": "string"
}
```

## Tweet Management Endpoints

### Add Tweet
**Endpoint:** `add_tweet`

**Input Parameters:**
- `aid` (string): App ID
- `hostid` (string): Host ID where tweet should be published
- `tweet` (string): JSON string of tweet object
- `nodeappcode` (string, optional): Node app code for peer validation

**Tweet Object Schema:**
```json
{
  "authorId": "string",
  "title": "string",
  "content": "string",
  "attachments": [
    {
      "mid": "string",
      "timestamp": "number"
    }
  ],
  "isPrivate": "boolean",
  "downloadable": "boolean",
  "originalTweetId": "string",
  "originalAuthorId": "string"
}
```

**Output Schema:**
```json
{
  "success": "boolean",
  "mid": "string"
}
```

### Get Tweet
**Endpoint:** `get_tweet`

**Input Parameters:**
- `aid` (string): App ID
- `appuserid` (string): Current app user ID
- `tweetid` (string): Tweet ID to retrieve

**Output Schema:**
```json
{
  "mid": "string",
  "authorId": "string",
  "title": "string",
  "content": "string",
  "attachments": [
    {
      "mid": "string",
      "timestamp": "number"
    }
  ],
  "isPrivate": "boolean",
  "downloadable": "boolean",
  "originalTweetId": "string",
  "originalAuthorId": "string",
  "timestamp": "number",
  "bookmarkCount": "number",
  "favoriteCount": "number",
  "commentCount": "number",
  "retweetCount": "number",
  "favorites": [boolean, boolean, boolean] // [isFavorite, isBookmarked, hasRetweeted]
}
```

### Get Tweet Feed
**Endpoint:** `get_tweet_feed`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID whose feed to retrieve
- `appuserid` (string): App user accessing the tweets
- `pn` (number): Page number
- `ps` (number): Page size

**Output Schema:**
```json
{
  "success": "boolean",
  "tweets": ["tweet_objects"],
  "originalTweets": ["tweet_objects"]
}
```

### Get Tweets by User
**Endpoint:** `get_tweets_by_user`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID whose tweets to retrieve
- `appuserid` (string): App user accessing the tweets
- `pn` (number): Page number
- `ps` (number): Page size

**Output Schema:**
```json
{
  "success": "boolean",
  "tweets": ["tweet_objects"],
  "originalTweets": ["tweet_objects"]
}
```

### Get Tweets by Rank
**Endpoint:** `get_tweets_by_rank`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `startrank` (number): Start rank
- `endrank` (number): End rank
- `appuserid` (string): App user ID

**Output Schema:** Array of tweet objects

### Get Tweets by Score
**Endpoint:** `get_tweets_by_score`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `minscore` (number): Minimum score
- `maxscore` (number): Maximum score
- `appuserid` (string): App user ID

**Output Schema:** Array of tweet objects

### Get Tweet List by Rank
**Endpoint:** `get_tweet_list_by_rank`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `startrank` (number): Start rank
- `endrank` (number): End rank

**Output Schema:** Array of tweet IDs

### Get Tweet ID List
**Endpoint:** `get_tweet_id_list`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:** Array of tweet IDs

### Delete Tweet
**Endpoint:** `delete_tweet`

**Input Parameters:**
- `aid` (string): App ID
- `tweetid` (string): Tweet ID to delete
- `authorid` (string): Author ID of the tweet

**Output Schema:**
```json
{
  "tweetid": "string",
  "success": "boolean"
}
```

### Refresh Tweet
**Endpoint:** `refresh_tweet`

**Input Parameters:**
- `aid` (string): App ID
- `tweetid` (string): Tweet ID to refresh
- `appuserid` (string): App user ID

**Output Schema:** Updated tweet object

### Get Pinned Tweets
**Endpoint:** `get_pinned_tweets`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `appuserid` (string): App user ID

**Output Schema:** Array of pinned tweet objects

### Toggle Pinned Tweet
**Endpoint:** `toggle_pinned_tweet`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `tweetid` (string): Tweet ID to pin/unpin

**Output Schema:** No specific return value

## Comment Management Endpoints

### Add Comment
**Endpoint:** `add_comment`

**Input Parameters:**
- `aid` (string): App ID
- `appuserid` (string): App user making the comment
- `tweetid` (string): Tweet ID being commented on
- `hostid` (string): Host ID where tweet is published
- `comment` (string): JSON string of comment object (same as tweet object)

**Output Schema:**
```json
{
  "success": "boolean",
  "mid": "string",
  "count": "number",
  "retweetid": "string"
}
```

### Get Comments
**Endpoint:** `get_comments`

**Input Parameters:**
- `aid` (string): App ID
- `appuserid` (string): App user ID
- `tweetid` (string): Tweet ID
- `pn` (number): Page number
- `ps` (number): Page size

**Output Schema:** Array of comment objects (same as tweet objects)

### Delete Comment
**Endpoint:** `delete_comment`

**Input Parameters:**
- `aid` (string): App ID
- `commentid` (string): Comment ID to delete
- `tweetid` (string): Tweet ID containing the comment

**Output Schema:** No specific return value

**Input Parameters:**
- `aid` (string): App ID
- `commentid` (string): Comment ID to delete
- `tweetid` (string): Tweet ID containing the comment
- `hostid` (string): Host ID where comment is stored

**Output Schema:** No specific return value

## Interaction Endpoints

### Toggle Favorite
**Endpoint:** `toggle_favorite`

**Input Parameters:**
- `aid` (string): App ID
- `appuserid` (string): App user favoriting the tweet
- `tweetid` (string): Tweet ID
- `authorid` (string): Tweet author ID
- `userhostid` (string): Host ID of the app user

**Output Schema:**
```json
{
  "user": "user_object",
  "isFavorite": "boolean",
  "count": "number"
}
```

### Toggle Favorite by User
**Endpoint:** `toggle_favorite_by_user`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `tweetid` (string): Tweet ID
- `isfavorite` (string): "true" or "false"

**Output Schema:** Updated user object

### Toggle Likes
**Endpoint:** `toggle_likes`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `tweetid` (string): Tweet ID

**Output Schema:** No specific return value

### Toggle Bookmark
**Endpoint:** `toggle_bookmark`

**Input Parameters:**
- `aid` (string): App ID
- `appuserid` (string): App user bookmarking the tweet
- `tweetid` (string): Tweet ID
- `authorid` (string): Tweet author ID
- `userhostid` (string): Host ID of the app user

**Output Schema:**
```json
{
  "user": "user_object",
  "isBookmarked": "boolean",
  "count": "number"
}
```

### Toggle Bookmark by User
**Endpoint:** `toggle_bookmark_by_user`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `tweetid` (string): Tweet ID
- `isbookmarked` (string): "true" or "false"

**Output Schema:** Updated user object

### Retweet Added
**Endpoint:** `retweet_added`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `tweetid` (string): Tweet ID

**Output Schema:** No specific return value

### Retweet Removed
**Endpoint:** `retweet_removed`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `tweetid` (string): Tweet ID

**Output Schema:** No specific return value

## Follow Management Endpoints

### Toggle Following
**Endpoint:** `toggle_following`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `otherid` (string): Other user ID to follow/unfollow
- `otherhostid` (string): Host ID of the other user

**Output Schema:** No specific return value

### Toggle Follower
**Endpoint:** `toggle_follower`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `otherid` (string): Other user ID
- `isfollower` (string): "true" or "false"

**Output Schema:** No specific return value

### Get Followers
**Endpoint:** `get_followers`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:** Array of follower user IDs

### Get Followers Sorted
**Endpoint:** `get_followers_sorted`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `startrank` (number): Start rank
- `endrank` (number): End rank

**Output Schema:** Array of follower user IDs

### Get Followings
**Endpoint:** `get_followings`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:** Array of following user IDs

### Get Followings Sorted
**Endpoint:** `get_followings_sorted`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `startrank` (number): Start rank
- `endrank` (number): End rank

**Output Schema:** Array of following user IDs

### Get Follow Count
**Endpoint:** `get_follow_count`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:**
```json
{
  "followers": "number",
  "followings": "number"
}
```

### Update Following Tweets
**Endpoint:** `update_following_tweets`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `tweetid` (string): Tweet ID

**Output Schema:** No specific return value

## File Management Endpoints

### Upload File
**Endpoint:** `upload_file`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `cid` (string): IPFS content identifier

**Output Schema:** No specific return value

### Upload IPFS
**Endpoint:** `upload_ipfs`

**Input Parameters:**
- `aid` (string): App ID
- `data` (string): Data to upload to IPFS

**Output Schema:**
```json
{
  "cid": "string"
}
```

### Upload Package
**Endpoint:** `upload_package`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `cid` (string): IPFS content identifier

**Output Schema:** No specific return value

### Share File
**Endpoint:** `share_file`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `fileid` (string): File ID to share

**Output Schema:** No specific return value

### Get Shared File
**Endpoint:** `get_shared_file`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:** Array of shared file objects

### Get Shared File IP
**Endpoint:** `get_shared_file_ip`

**Input Parameters:**
- `aid` (string): App ID
- `fileid` (string): File ID

**Output Schema:**
```json
{
  "ip": "string"
}
```

## System Endpoints

### Get Node IP
**Endpoint:** `get_node_ip`

**Input Parameters:**
- `aid` (string): App ID
- `nodeid` (string): Node ID

**Output Schema:**
```json
{
  "ip": "string"
}
```

### Get Provider
**Endpoint:** `get_provider`

**Input Parameters:**
- `aid` (string): App ID
- `mid` (string): Mimei ID

**Output Schema:**
```json
{
  "ip": "string"
}
```

**Usage:** Returns the provider IP address for a given user/resource ID. This is used for IP resolution when connecting to distributed nodes.

**Client-Side Implementation:**

The iOS client uses a **smart retry strategy** for IP resolution:

**First Attempt:**
- Uses cached IP address (if available)
- Fast, minimal network overhead
- Works when IP hasn't changed

**Retry Attempts (2/3, 3/3):**
- Calls `get_provider` to get fresh IP
- Handles server migrations automatically
- Updates cached IP for future use

**Example Flow:**
```swift
// Attempt 1: Try cached IP (http://183.156.84.30:8002)
// Fails: Connection reset by peer

// Attempt 2: Call get_provider → Returns new IP (183.156.84.30:8003)
// Success: User data fetched from new IP
```

**Benefits:**
- ⚡ Faster first attempts (no IP lookup)
- 🔄 Automatic recovery from IP changes
- 💰 Reduced load on provider service
- 🛡️ Handles server migrations gracefully

**See Also:** `NETWORK_RESILIENCE.md` for complete retry strategy documentation

### Get Providers
**Endpoint:** `get_providers`

**Input Parameters:**
- `aid` (string): App ID
- `mid` (string): Mimei ID

**Output Schema:** Array of provider IPs

**Usage:** Returns multiple provider IPs for redundancy and load balancing.

### Node Get Score
**Endpoint:** `node_get_score`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `mid` (string): Mimei ID

**Output Schema:**
```json
{
  "score": "number"
}
```

### Node Update Score
**Endpoint:** `node_update_score`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `mid` (string): Mimei ID

**Output Schema:** No specific return value

### Node Update Tweet
**Endpoint:** `node_update_mid_by_score`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `tweetid` (string): Tweet ID

**Output Schema:** No specific return value

### Sync User
**Endpoint:** `sync_user`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:** No specific return value

### Toggle Meta by User
**Endpoint:** `toggle_meta_by_user`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `key` (string): Meta key
- `value` (string): Meta value

**Output Schema:** No specific return value

### Toggle Meta by User Host
**Endpoint:** `toggle_meta_by_user_host`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `hostid` (string): Host ID
- `key` (string): Meta key
- `value` (string): Meta value

**Output Schema:** No specific return value

## Message Endpoints

### Message Check
**Endpoint:** `message_check`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:** Message check result

### Message Fetch
**Endpoint:** `message_fetch`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:** Array of messages

### Message Incoming
**Endpoint:** `message_incoming`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `message` (string): Message content

**Output Schema:** No specific return value

### Message Outgoing
**Endpoint:** `message_outgoing`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `message` (string): Message content

**Output Schema:** No specific return value

## Utility Endpoints

### Mimei Provide
**Endpoint:** `mimei_provide`

**Input Parameters:**
- `aid` (string): App ID
- `mid` (string): Mimei ID

**Output Schema:** No specific return value

### Open Mac
**Endpoint:** `open_mac`

**Input Parameters:**
- `aid` (string): App ID
- `filepath` (string): File path to open

**Output Schema:** No specific return value

### Open Temp File
**Endpoint:** `open_temp_file`

**Input Parameters:**
- `aid` (string): App ID
- `filename` (string): Temporary file name

**Output Schema:** No specific return value

### Logging
**Endpoint:** `logging`

**Input Parameters:**
- `aid` (string): App ID
- `level` (string): Log level
- `message` (string): Log message

**Output Schema:** No specific return value

## Upgrade Endpoints

### Check Upgrade
**Endpoint:** `check_upgrade`

**Input Parameters:**
- `aid` (string): App ID
- `version` (string): Current version

**Output Schema:**
```json
{
  "hasUpgrade": "boolean",
  "version": "string",
  "url": "string"
}
```

### Download Upgrade
**Endpoint:** `download_upgrade`

**Input Parameters:**
- `aid` (string): App ID
- `version` (string): Version to download

**Output Schema:** Upgrade package data

## Common Error Response

All endpoints may return an error response in the following format:

```json
{
  "success": false,
  "error": "error_message"
}
```

## Notes

1. All endpoints require the `aid` (App ID) parameter for authentication and routing
2. Boolean values are often passed as strings ("true"/"false") in request parameters
3. Many endpoints support cross-node operations and will automatically route requests to the appropriate host
4. File uploads use IPFS for decentralized storage
5. The system uses Mimei IDs for unique identification of users, tweets, and other entities
6. Pagination is supported for list endpoints using `pn` (page number) and `ps` (page size) parameters 