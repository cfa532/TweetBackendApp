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

### User sessions (`usersid`)

A client identifies itself by signing in to the node's own Leither RPC and
passing the session id it receives as `usersid`. The node resolves it to a
Leither user id; each account records the id that controls it as `authUid`.
`health` advertises this with `userSessions: true`, and reports whether guests
may register as `guestRegistration`.

- **Owner**: `tweet-owner.sh` on the node issues a Leither key and lists its
  user id in `tweet.node.json`. The app signs in with `LoginWithPPT`, then calls
  `login` with only `usersid`. The reply carries `owner: true` and the account,
  which is created on the first call.
- **Guest**: the app calls Leither `Register(username, password, "")` and
  `Login(username, password)` on the root node, then `register` with `usersid`
  (the account stores no password), and later `login` with `usersid` and
  `username`. Password changes go through Leither `SetUserInfo(sid, {newpass})`.
- **Account created before sessions**: `login` with `usersid`, `username` and
  `password` on the root node binds the account to the session's user after
  checking the stored password, which is left in place for older clients.

Writes to the caller's own data accept `usersid` (`add_tweet`, `update_tweet`,
`delete_tweet`, `toggle_tweet_privacy`, `toggle_pinned_tweet`,
`toggle_following`, `block_user`, `remove_blacklisted_relationship`,
`set_author_core_data`, `set_user_avatar`, `delete_account`,
`message_outgoing`, `message_fetch`, `share_file`, `pin_ipfs`, `upload_file`,
`add_comment`, `delete_comment`). When present, the session's user must control
the account named by the request, otherwise the write is refused. A session
this node does not know fails with the message `Session invalid`; sign in again
and repeat the request. A request without `usersid`, or for an account with no
`authUid`, is generally accepted until `ownerSessionRequired` is switched on.
Tweet moderation and its account setting require a bound Leither session
throughout the rollout. Accounts that revoke admin access also require
identity verification on direct tweet writes, profile edits and account
deletion, so the legacy unsigned forms cannot bypass revocation.

### Admin tweet delegation

- `admin_tweet_access` runs on the account's root. Send `userid` to read the
  policy or include `allowed="true"|"false"` and the account's `usersid` to change
  it. The reply is `{success: true, allowed: boolean}`. Existing accounts allow
  moderation by default.
- `admin_mutate_tweet` runs on the existing `admin` account's root with that
  account's `usersid` and `userid`. Send `authorid`, `tweetid` and `action`
  (`update` or `delete`). Updates accept the content and optional attachment
  and flag parameters of `update_tweet`. Successful updates return `mid`;
  deletions return `tweetid`, using the normal tweet mutation response shapes.
- The peer-only `apply_admin_tweet_mutation` runs on the author's root. It
  verifies the admin delegation and checks the author's current policy and
  tweet-list membership before editing or deleting. It cannot moderate
  comments or act as the author on other endpoints.
- `health` advertises `adminTweetDelegation: true`. The username `admin` is
  reserved from guest registration. An existing administrator can bind by
  signing in, and a new one can be provisioned as a node owner.

Comments are written through the commenter's own root node, which asks the
parent author's node to perform the write (see the Comment endpoints). The
node-to-node halves of that flow (`apply_comment`, `remove_comment`) accept no
user session: they admit only the delegating node, named by the platform's
`nodeappcode` injection (cross-node) or the application author's session
(same-node), bound to the comment writer's own root. `health` advertises the
arrangement as `commentDelegation: true`.

`register` is refused with `This node does not accept new registrations` when
the node's owners have run `tweet-owner.sh --guests deny`.

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
- `requestid` (string, optional): a caller-generated id naming this
  submission. The tweet's Mimei id is derived from it, so a retry after a
  lost response resolves the same tweet instead of creating a duplicate —
  every step of the entry (list entry, references) converges on the same id.
  Without one, a fresh id is minted on every accepted request and a retry
  creates a second tweet.
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
- `fromdetailview` (string, optional): `"true"` for a detail-view read. A non-root node then becomes a provider of the tweet, and pulls the tweet from its root first if it holds no data for it yet
- `authorhostid` (string, optional): the author's root host ID, so the node need not look up the author's account
- `authorid` (string, optional): author of the tweet, used instead of `authorhostid` to find the root host (the server sets it for the quoted tweet of a v3 reply)

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
  "parentTweetId": "string",
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
- `version` (string): Use `v3` for requester/owner-aware deletion
- `userid` (string): Requesting user ID for `v3`
- `authorid` (string): Author ID of the tweet for `v3`
- `tweetid` (string): Tweet ID to delete

For legacy `v2` callers, `appuserid` may identify the requester while `userid`
identifies the tweet author.

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

Comments still live on the parent author's root node, but a client no longer
writes there. `add_comment` and `delete_comment` are called on the comment
writer's (or deleter's) own root node with their `usersid`; that node asks the
parent author's node to perform the parent-side write through `apply_comment`
or `remove_comment`. A node advertises this arrangement in `health` as
`commentDelegation: true`; a node without it still takes the old form — the
request sent straight to the parent author's node, no session.

### Add Comment
**Endpoint:** `add_comment` — called on the comment writer's root node

**Input Parameters:**
- `aid` (string): App ID
- `usersid` (string): the writer's Leither session on this node
- `tweetid` (string): Tweet ID being commented on
- `tweetauthorid` (string): the parent author's user ID (legacy name; not the
  comment's author)
- `comment` (string): JSON string of comment object (same as tweet object); its
  `authorId` is the writer and names the account the session must control
- `requestid` (string, optional): a caller-generated id naming this
  submission; the comment's id is derived from it, so a retried comment
  resolves the same object instead of creating a duplicate. A quote-comment's
  retweet half is named `<requestid>-quote`.

**Output Schema:**
```json
{
  "success": "boolean",
  "mid": "string",
  "commentId": "string",
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
**Endpoint:** `delete_comment` — called on the deleter's root node

Only the comment's author and the parent's author may delete; the check runs on
the parent author's node, which holds the comment object. A refused deletion
returns that refusal unchanged.

**Input Parameters:**
- `aid` (string): App ID
- `usersid` (string): the deleter's Leither session on this node
- `appuserid` (string): the deleting user ID
- `tweetid` (string): Tweet ID containing the comment
- `commentid` (string): Comment ID to delete
- `hostid` (string, old form only): Host ID where comment is stored

**Output Schema:**
```json
{
  "success": "boolean",
  "commentId": "string",
  "count": "number"
}
```

### Apply Comment (node to node)
**Endpoint:** `apply_comment` — reached from `add_comment` on the writer's node;
not part of the client surface

Creates the comment object on the parent author's root node, adds the parent's
list entry and Mimei reference, and publishes. This is also where a parent
author's comment policy (who may comment) will be checked; no such setting
exists yet.

The caller must be the comment writer's own root node. A cross-node request is
identified by the `nodeappcode` the platform injects on this node (the
forwarding transport deletes `sid`); the code must resolve to the writer's
root. A same-node delegation carries the local author session in `sid`, checked
against the node-set `author` key. Anything else is refused with
`Not called from a peer node`. If this node holds no copy of the writer's
account, one is pulled (`MiMeiSync`) to resolve their root.

**Input Parameters:**
- `aid` (string): App ID (its presence is what makes the platform inject the
  node app code on the cross-node hop)
- `sid` (string, local hop only): the application author's session
- `tweetid` (string): Tweet ID being commented on
- `tweetauthorid` (string): the parent author's user ID
- `comment` (string): JSON string of comment object, quote fields stripped

**Output Schema:** as Add Comment, without `retweetid`.

### Remove Comment (node to node)
**Endpoint:** `remove_comment` — reached from `delete_comment` on the deleter's
node; not part of the client surface

Deletes the comment object and detaches it from the parent on the parent
author's root node, after checking the named deleter is the comment's author or
the parent's author. The caller must be the deleter's own root node, verified
the same way as `apply_comment`.

**Input Parameters:**
- `aid` (string): App ID
- `sid` (string, local hop only): the application author's session
- `tweetid` (string): Tweet ID containing the comment
- `commentid` (string): Comment ID to delete
- `appuserid` (string): the deleting user ID, verified by their own root node

**Output Schema:** as Delete Comment.

## Interaction Endpoints

Likes, bookmarks and retweet counts follow the same delegation as comments:
the engaging user calls the entry on their OWN root node with their `usersid`,
and that node asks the tweet author's node to perform the tweet-side write
through a guarded peer entry. A node advertises this in `health` as
`engagementDelegation: true`; a node without it still takes the old form — the
request sent straight to the tweet author's node, no session.

### Toggle Favorite
**Endpoint:** `toggle_favorite` — called on the engaging user's root node

**Input Parameters:**
- `aid` (string): App ID
- `usersid` (string): the engaging user's Leither session on this node
- `appuserid` (string): App user favoriting the tweet
- `tweetid` (string): Tweet ID
- `authorid` (string): Tweet author ID
- `userhostid` (string): Host ID of the app user
- `isfavorite` (string, optional): "true"/"false" makes the toggle idempotent;
  omitted flips the user's own list
- `hostid` (string, new form): the tweet author's host, the delegation target

**Output Schema:**
```json
{
  "success": "boolean",
  "user": "user_object",
  "tweet": "tweet_object"
}
```

### Toggle Bookmark
**Endpoint:** `toggle_bookmark` — called on the engaging user's root node

Same contract as Toggle Favorite, with `userid` naming the engaging user and
`isbookmarked` as the state parameter.

### Apply Favorite / Apply Bookmark (node to node)
**Endpoint:** `apply_favorite` / `apply_bookmark` — reached from the toggle on
the engaging user's node; not part of the client surface

Performs the tweet-side write on the tweet author's root node. The caller must
be the engaging user's own root node (`nodeappcode`-bound as with
`apply_comment`; a local hop carries the author session in `sid`); the tweet
must belong to the named `authorid`; an account this node has never seen is
pulled once to resolve the engaging user's root. Refusals: `Not called from a
peer node`, `Author host not found`, `Tweet does not belong to the named
author`, `User ... is not known here`.

**Input Parameters:**
- `aid` (string): App ID
- `sid` (string, local hop only): the application author's session
- `tweetid` (string): Tweet ID
- `authorid` (string): Tweet author ID
- `userid` (string): the engaging user
- `wanted` (string): "true" or "false"

**Output Schema:** `{ "success": boolean, "tweet": tweet_object }`

`toggle_favorite_by_user` and `toggle_bookmark_by_user`, the pre-delegation
user-side halves, are removed: they let any caller edit any user's saved lists.
A node still on the old backend that calls them here is refused.

### Retweet Added / Retweet Removed
**Endpoint:** `retweet_added` / `retweet_removed` — called on the retweeting
user's root node

There is no user-side retweet list, so these entries are a verified delegation
and nothing else: the retweeter's node asks the original author's node to add
or clear the record.

**Input Parameters:**
- `aid` (string): App ID
- `usersid` (string): the retweeter's Leither session on this node
- `appuserid` (string): the retweeting user
- `retweetid` (string): the retweet's own tweet ID
- `tweetid` (string): the original tweet ID
- `authorid` (string): the original author ID
- `hostid` (string, new form): the original author's host, the delegation target

**Output Schema:** the refreshed original tweet.

### Apply Retweet (node to node)
**Endpoint:** `apply_retweet` — reached from `retweet_added`/`retweet_removed`
on the retweeter's node; not part of the client surface

Same guard and parent-authority check as the engagement peers; the list it
writes is keyed by retweet id, valued by the retweeting user.

**Input Parameters:** as the engagement peers, plus `retweetid`.

**Output Schema:** `{ "success": boolean, "tweet": tweet_object }`

## Follow Management Endpoints

### Toggle Following
**Endpoint:** `toggle_following` — called on the follower's root node

**Input Parameters:**
- `aid` (string): App ID
- `usersid` (string): the follower's Leither session on this node
- `userid` (string): User ID
- `followingid` (string): Other user ID to follow/unfollow
- `followingid_hostid` (string): Host ID of the other user

**Output Schema:** `{ "isFollowing": boolean }` (v2-enveloped)

### Toggle Follower (node to node)
**Endpoint:** `toggle_follower` — reached from `toggle_following` on the
follower's node; not part of the client surface

Records or removes a follower on the followed user's root node. Only the
follower's own root may ask: the platform-injected node app code must name it,
and an account this node has never seen is pulled once to resolve the root. A
bare client call is refused with `Not called from a peer node`.

**Input Parameters:**
- `aid` (string): App ID
- `sid` (string, local hop only): the application author's session
- `userid` (string): the followed user
- `otherid` (string): the follower
- `isfollower` (string): "true" or "false"

**Output Schema:** `{ "success": boolean, "isFollower": boolean }`

### Get Followers
**Endpoint:** `get_followers`

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID
- `pn` (number, optional): Zero-based page number; defaults to `0`

**Output Schema:** Object containing `users` (up to 10 complete user objects, newest-follower first) and `success`

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
- `pn` (number, optional): Zero-based page number; defaults to `0`

**Output Schema:** Object containing `users` (up to 10 complete user objects, newest-followed first) and `success`

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

Messages follow the same delegation as comments and engagement: the sender
calls `message_outgoing` on their OWN root node with their `usersid`, and that
node delivers the recipient's copy through the peer-only `message_incoming` on
the recipient's node. A node advertises this in `health` as
`messageDelegation: true`; a node without it still takes the old form — the
client writing `message_incoming` on the recipient's node directly.

### Message Outgoing
**Endpoint:** `message_outgoing` — called on the sender's root node

Stores the sender's copy, then delivers the recipient's copy through the
guarded peer path. The recipient's copy is the delivery, so a refused or
unreachable recipient node fails the send (`{"sent": false}`).

**Input Parameters:**
- `aid` (string): App ID
- `usersid` (string): the sender's Leither session on this node
- `userid` (string): the sender's user ID
- `receiptid` (string): the recipient's user ID
- `msg` (string): JSON string of the message object

**Output Schema:** `{"success": boolean, "data": {"sent": boolean}}`

### Message Incoming (node to node)
**Endpoint:** `message_incoming` — reached from `message_outgoing` on the
sender's node; not part of the client surface

Stores the recipient's copy and marks the unread indicator. Only the sender's
own root node may deliver here: the platform-injected node app code must name
it, and a sender this node has never seen is pulled once to resolve the root. A
bare client call is refused with `Not called from a peer node`.

**Input Parameters:**
- `aid` (string): App ID
- `sid` (string, local hop only): the application author's session
- `senderid` (string): the sender's user ID
- `receiptid` (string): the recipient's user ID
- `msg` (string): JSON string of the message object

**Output Schema:** `{"success": boolean}`

### Message Check
**Endpoint:** `message_check`

Reports the newest unread message from each correspondent, for notifications;
does not mark anything read. Read-only.

**Input Parameters:**
- `aid` (string): App ID
- `userid` (string): User ID

**Output Schema:** Array of unread message objects

### Message Fetch
**Endpoint:** `message_fetch` — called on the user's root node (it marks the
conversation read, which writes)

**Input Parameters:**
- `aid` (string): App ID
- `usersid` (string): the user's Leither session on this node
- `userid` (string): User ID
- `senderid` (string): the correspondent whose messages to fetch

**Output Schema:** Array of message objects

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
- `version` (string): Response protocol selector; current clients send `v2`

The Android client's installed version is not sent to this endpoint. The client
compares the returned `versionCode` with its own `BuildConfig.VERSION_CODE`.

**Output Schema:**
```json
{
  "enabled": "boolean",
  "version": "number (legacy versionName comparison)",
  "versionCode": "number",
  "versionName": "string",
  "packageId": "string",
  "size": "number of bytes",
  "sha256": "lowercase hexadecimal string",
  "mission": "minor | major | critical",
  "domain": "string"
}
```

Field semantics:

- `enabled` is the server-side release gate.
- `versionCode` is the only ordering key and must increase for every APK.
- `versionName` is required display/compatibility metadata in the current
  protocol; it is not used to order releases.
- `version` is retained for legacy clients that compared numeric display
  versions.
- `size` and `sha256` describe the exact signed APK stored under `packageId`.
- `mission` controls prompt severity, not version selection.

Publish and verify the APK on all selectable MiMei providers before deploying
an enabled response with its metadata. A client rejects an APK when its size,
SHA-256, package name, or Android version code differs from this response.

### Download Upgrade
**Endpoint:** `download_upgrade`

**Input Parameters:**
- `aid` (string): App ID
- `version` (string): Response protocol selector when supplied

**Output Schema:** The package MiMei ID as a string. Clients resolve a healthy
provider and download it from `/mm/<packageId>`.

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
