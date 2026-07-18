# Stale Following Cleanup Design

## Problem

`update_following_tweets` reads each ID in `list_of_followings_mid` on the calling user's authoritative `hostIds[0]`. If an ID no longer resolves to a user object, the function logs the failure and retries forever. A temporary outage must not cause an automatic unfollow.

## Design

Store access-failure state in a separate `failed_following_accesses` hash inside the calling user's object. Each field is a following ID and each value contains `firstFailedAt`, `lastFailedAt`, and `attempts`.

An access fails only when the followed user object cannot be read, including an exception while opening or reading it. Failures after a user object has been read, such as a downstream synchronization or tweet-read error, do not count. A successful user-object read deletes any existing failure state immediately.

On a failed access, increment the counter and retain the original first-failure time. Remove the ID from `list_of_followings_mid` on the fifteenth or later failure only when the first failure is strictly more than fourteen days old. Delete its failure record at the same time.

Before routing or writing, `update_following_tweets` verifies `request.hostid` against the calling user's stored `hostIds[0]`; an unverifiable or mismatched request fails without mutating following state. All tracking and removal writes occur only while the function runs on that verified home node. Any mutation causes the calling user object to be backed up and published, even if no new tweets were found. Bookkeeping or persistence failures return an error instead of silently reporting success.

## Scope

Automatic cleanup removes only the inaccessible ID from the authoritative following list. It does not alter the inaccessible user's follower count or scan old feed entries because the target user's data is unavailable. Existing API response shapes and following-list values remain unchanged.

## Verification

Add coverage for failure thresholds and resets, malformed state, authoritative-host rejection, partial mutations, and persistence errors. Per repository policy, tests are added but not executed unless explicitly requested; syntax checks and diff review are used for this change.
