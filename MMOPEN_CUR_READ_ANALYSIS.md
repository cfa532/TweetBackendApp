# Analysis: MMOpen with "cur" followed by immediate read operations

This document lists all cases where `lapi.MMOpen()` is called with "cur" parameter and then immediately used to read data.

## Summary

Found **12 files** with cases where `MMOpen(..., "cur")` is followed by immediate read operations:

## Detailed Cases

### 1. `set_author_core_data.js` - Line 68-69
```javascript
const userSid = lapi.MMOpen(authSid, user.mid, "cur")  // Open user's memory space
const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)  // Get existing user data from storage
```
**Read operation**: `lapi.Get()` - Reads user data immediately after opening

---

### 2. `set_user_avatar.js` - Line 55-56
```javascript
const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space
const userInDB = lapi.Get(userSid, OWNER_DATA_KEY)  // Get user data from storage
```
**Read operation**: `lapi.Get()` - Reads user data immediately after opening

---

### 3. `update_tweet_privacy.js` - Line 111-112
```javascript
const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
```
**Read operation**: `lapi.Get()` - Reads tweet content immediately after opening

---

### 4. `delete_tweet.js` - Line 104-105
```javascript
const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")
const tweet = lapi.Get(tweetSid, TWT_CONTENT_KEY)
```
**Read operation**: `lapi.Get()` - Reads tweet content immediately after opening

---

### 5. `toggle_pinned_tweet.js` - Line 89-96
```javascript
const userSid = lapi.MMOpen(authSid, appUserId, "cur")  // Open user's memory space

// Check if tweet is already pinned
const pinned = lapi.Hget(userSid, PINNED_TWEETS, tweetId)
```
**Read operation**: `lapi.Hget()` - Reads pinned tweet status immediately after opening

---

### 6. `toggle_favorite_by_user.js` - Line 94-106
```javascript
const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space

// ...
if (lapi.Hget(userSid, FAVORITE_LIST, tweetId)) {
    lapi.Hdel(userSid, FAVORITE_LIST, tweetId)
}
```
**Read operation**: `lapi.Hget()` - Conditionally reads favorite status immediately after opening (within same block)

---

### 7. `toggle_bookmark_by_user.js` - Line 93-105
```javascript
const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space

// ...
if (lapi.Hget(userSid, BOOKMARK_LIST, tweetId)) {
    lapi.Hdel(userSid, BOOKMARK_LIST, tweetId)
}
```
**Read operation**: `lapi.Hget()` - Conditionally reads bookmark status immediately after opening (within same block)

---

### 8. `toggle_bookmark.js` - Line 156-159
```javascript
const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")  // Open tweet for editing

// Check if user has already bookmarked this tweet
const hasMarked = lapi.Hget(tweetSid, BOOKMARK_LIST, appUserId) ? true : false
```
**Read operation**: `lapi.Hget()` - Reads bookmark status immediately after opening

---

### 9. `toggle_favorite.js` - Line 111-118
```javascript
const tweetSid = lapi.MMOpen(authSid, tweetId, "cur")  // Open tweet for editing

// Check if user has already favorited this tweet
const isFavorite = lapi.Hget(tweetSid, FAVORITE_LIST, appUserId) ? true : false
```
**Read operation**: `lapi.Hget()` - Reads favorite status immediately after opening

---

### 10. `message_fetch.js` - Line 75-79
```javascript
const msgSid = lapi.MMOpen(authSid, msgMid, "cur")

// Get the last time user fetched messages from this sender
let lastTimeFetched = 0
const rank = lapi.Zrank(msgSid, LAST_FETCH_MSG, senderId)
```
**Read operation**: `lapi.Zrank()` - Reads message rank immediately after opening (followed by `lapi.Zscore()` on line 81)

---

### 11. `share_file.js` - Line 91-98
```javascript
const userSid = lapi.MMOpen(authSid, userId, "cur")  // Open user's memory space

// If the mid exists, it has been shared, just return it
const sharedObj = lapi.Hget(userSid, USER_SHARE_MID, mid)
```
**Read operation**: `lapi.Hget()` - Reads shared file object immediately after opening

---

### 12. `update_following_tweets.js` - Line 138-139
```javascript
const mmsid = lapi.MMOpen(authSid, userId, "cur")
const followings = lapi.Hkeys(mmsid, FOLLOWINGS_LIST) // mid list of its followings
```
**Read operation**: `lapi.Hkeys()` - Reads all followings immediately after opening

---

## Notes

- All cases open memory space with "cur" (current version) and immediately perform read operations
- Most common pattern: Opening to read existing data before making modifications
- Read operations include: `Get()`, `Hget()`, `Hkeys()`, `Zrank()`, `Zscore()`
- These patterns suggest potential optimization opportunities or may indicate race condition risks if "cur" doesn't guarantee consistent state for reading

