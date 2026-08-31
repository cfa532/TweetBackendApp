# Leither Data and Synchronization Contract

This document is the canonical cross-project contract for synchronization and object ownership in:

- `TweetBackendApp` — shared backend
- `Tweet-iOS` — iOS client
- `Tweet` — Android client
- `TweetWeb` — Web client

Read this document before changing object creation, references, node routing, synchronization, profile loading, detail loading, comments, replies, or the `get_*`, `resync_user`, and `refresh_tweet` APIs.

## Root and Access Nodes

An object's root node is its authoritative write location. An access node may hold and serve a synchronized copy.

Leither is intended to keep access-node copies synchronized with their root-node objects. That synchronization is still under development and is not yet reliable enough to be the clients' only recovery mechanism.

## Object Ownership and Storage

### User

A user object is authoritative on the user's root node.

### Tweet

A tweet is stored on its own author's root node. When a tweet is created, its author user object must contain a Mimei reference to the tweet:

```text
User --reference--> Tweet
```

The tweet author's identity determines the tweet's storage node.

### Comment and Reply

A comment is also a Tweet object, but its storage rule is different from a top-level tweet.

A comment is stored on the root node of its parent tweet/comment's author, regardless of who wrote the comment. The comment writer remains represented by `comment.authorId` inside the comment data.

When a comment is created, its parent object must contain a Mimei reference to the comment:

```text
Parent Tweet/Comment --reference--> Comment/Reply
```

For `add_comment`, these identities must not be confused:

```text
hostid         = parent author's root host ID
tweetauthorid  = parent author's user ID (legacy name)
comment.authorId = user who wrote the comment
tweetid        = parent tweet/comment ID
```

`tweetauthorid` is a legacy and misleading field name. It means the parent object's author ID, not the comment writer's ID.

Replies follow the same rule: a reply is stored on its parent comment author's root node and is directly referenced by that parent comment.

## One-Level Reference Synchronization

Leither follows Mimei references one level below the synchronized parent. It does not recursively synchronize the full descendant graph.

```text
User
└── Tweet                  included when User is synchronized
    └── Comment            not included by the User synchronization
        └── Reply          not included by the User synchronization
```

Likewise:

- Synchronizing a User includes that User's directly referenced Tweets.
- Synchronizing a Tweet includes that Tweet's directly referenced Comments.
- Synchronizing a Comment includes that Comment's directly referenced Replies.
- Synchronization stops after that one child layer.

The sorted lists used for pagination, such as a tweet's comment list, do not replace Mimei references. Both the list entry and the parent-to-child reference must be maintained.

## Backend Reference Invariants

Successful creation must establish these references before the updated parent is backed up and published:

```text
create tweet:   MMAddRef(user, userId, tweetId)
create comment: MMAddRef(parent, parentId, commentId)
delete tweet:   MMDelRef(user, userId, tweetId)
delete comment: MMDelRef(parent, parentId, commentId)
```

After adding or deleting a reference, back up and publish the parent object so other nodes can observe its current child graph.

If comment creation is delegated to the parent author's remote root node, that node owns creation of the comment and the parent-to-comment reference. Synchronizing the updated parent back to the initiating node should then carry its direct comment children.

## Read and Recovery APIs

Normal reads trust the access node:

- `get_user` reads a user copy.
- `get_tweet` reads a tweet/comment copy.
- `get_comments` reads the direct children listed by a tweet/comment.

Explicit synchronization APIs are temporary client-side remedies while Leither synchronization is unreliable:

- `resync_user` synchronizes a User from its root and therefore also its directly referenced Tweets. It does not synchronize the Tweets' Comments.
- `refresh_tweet` synchronizes a Tweet or Comment from its root and therefore also its directly referenced Comments or Replies. It does not recursively synchronize deeper descendants.

After `refresh_tweet`, clients still call `get_comments` to load and render the refreshed direct children.

## Current Client Policy

Routine screen opening should use normal read APIs rather than forcing synchronization.

On iOS and Android, explicit user recovery is attached to pull-to-refresh:

- Profile pull: `resync_user` for the User and direct Tweets.
- Tweet Detail pull: `refresh_tweet`, then `get_comments` for direct Comments.
- Comment Detail pull: `refresh_tweet`, then `get_comments` for direct Replies.

Periodic detail refreshes use ordinary reads and do not force `refresh_tweet`.

TweetWeb currently has no pull-to-refresh interaction. Any Web recovery synchronization must therefore have an explicit, intentional trigger; it must not be accidentally hidden inside a general-purpose cached read helper.

Do not remove the explicit recovery APIs merely because Leither is expected to perform synchronization. They remain necessary until Leither's behavior is verified to be reliable in production. Conversely, do not run these heavier recovery operations on every routine screen opening without a documented need.

## Backend Synchronization Policy

The backend mirrors the client policy above. A node that already provides a
Mimei is kept current by Leither's own replication, so `MiMeiIsProvider` — a
local table lookup, not a network call — decides whether a pull is needed:

- **Explicit user recovery forces the sync.** Feed, Tweet Detail and Profile
  pull-to-refresh reach `update_following_tweets`, `refresh_tweet`,
  `resync_user` and `sync_user`, and the user is waiting on the newest data.
  Being a provider promises the copy will catch up, not that it already has.
- **Taking or keeping a copy checks `MiMeiIsProvider` first.** Following an
  account, saving a tweet, quoting a tweet and `mimei_provide` want possession,
  not freshness; replication supplies the rest. A node holding no copy at all is
  not a provider, so the check costs nothing there.

Pulling an object back after a write is not a case the backend has. Clients send
every mutation to the account's root node themselves, so no node forwards a
write and then synchronizes the result back. The delegated-write branches still
present in the legacy `.js` entries are dead paths, not a pattern to copy.

Routine reads still force nothing: `get_tweet` with `fromdetailview` announces
the tweet only when this node is not already a provider.

## Review Checklist

Before changing creation, loading, or synchronization code, verify:

1. Is the object being written to the correct root node?
2. For comments/replies, is routing based on the parent author's root node rather than the comment writer's root node?
3. Does the parent receive the correct child Mimei reference?
4. Is the parent backed up and published after its reference changes?
5. Does deletion remove both the pagination-list entry and Mimei reference?
6. Is the code relying on only one level of synchronization?
7. Does the recovery call synchronize the correct parent level for the missing data?
8. Are normal reads and explicit recovery operations kept distinct?
9. Have impacts been checked across iOS, Android, Web, and backend callers?
10. Does a forced synchronization serve explicit user recovery, rather than work
    `MiMeiIsProvider` shows is unnecessary?
