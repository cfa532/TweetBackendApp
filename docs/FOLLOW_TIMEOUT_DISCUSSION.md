# Follow timeout discussion — 2026-09-11

## Decision

Record the investigation and options only. Leave backend and client code unchanged.
No implementation approach has been selected.

## Observed behavior

The user confirmed that following Admin from Android succeeds and updates server
data correctly, but Android reports an error.

Provided server logs show:

- 11:21:33: Agirl (`iBYxJtqkOVROojJVodqHwzzxF5y`) begins following Admin
  (`mKOihoVuFnQ2xt33R51KTQXSBkX`). The target tweet-list lookup returns one entry.
- 11:21:43: the actor's node logs `relationship persisted`, after the local
  relationship/feed writes, backup, and publish calls.
- 11:25:16: Admin's node logs `isFollower=true` for Agirl.

An earlier Admin-node entry at 11:21:16 with `isFollower=false` was superseded by
the user supplying the correct follow log above.

If the follow entries belong to the same request and both node clocks agree,
the follower-side update finishes 3 minutes 43 seconds after the first entry.
The excerpts do not establish request correlation, clock agreement, or which
backend operation caused the delay.

## Code inspection findings

- Android's `HproseInstance.toggleFollowing()` sends `userid` as the actor,
  `followingid` as the target, `followingid_hostid` as the target's root-node
  hint, and `version=v2`. It routes the mutation to the actor's writable root.
- The JavaScript backend's successful follow response is
  `{"success":true,"data":{"isFollowing":true}}`. Android's parser accepts this
  format. A returned `isFollowing=false` means a successful unfollow, not an
  operation failure. No response-format mismatch was found in this path.
- Android explicitly uses `TOGGLE_MUTATION_TIMEOUT_MS = 60_000`. The writable
  client pool includes the timeout in its key. The locally installed Hprose
  2.0.38 source applies it to the synchronous response wait and HTTP
  connection/read timeouts.
- Android converts caught request exceptions, including timeouts, to `null`.
  `FollowUserWorker` treats `null` as failure, posts a failure notification,
  and causes `UserViewModel` to roll back optimistic relationship/count state.
  The toggle is not automatically retried, because another toggle could undo
  an operation that succeeded on the server.
- In `toggle_following.js`, the target tweet list is fetched before the actor's
  relationship is saved. Up to **20**, not 10, recent tweet ID/score entries are
  seeded into `followings_tweets`. Synchronizing tweet objects is a separate
  operation through target-user synchronization.
- After logging actor-side persistence, the JavaScript handler still performs
  any needed target-user sync/provide work, calls `toggle_follower` on the
  target's node, and updates the actor's score before returning. Sync and
  follower-call exceptions are caught locally, but waiting for those calls can
  still exceed the client timeout.

A timeout is the leading explanation, not a confirmed incident root cause.
Android's `Exception thrown by runMApp` details or its
`toggle_following completed in ... rawResponse: ...` log are needed to distinguish
a timeout from another request/response failure. The installed Android build
and deployed backend versions were not independently verified.

## Proposed success boundary and constraint

The user proposed treating the operation as successful once the actor adds the
target to its following list, regardless of later tweet or follower-side work.
The discussion refined that boundary to a **durably saved actor relationship**,
including backup, rather than merely a successful in-memory/write call.

Returning the existing success response at that boundary would let Android
recognize success without changing its parser. However, continuing the remaining
work after returning requires background execution. **The user confirmed that
the backend has no such mechanism.** The earlier suggestion of a backend-only
early-response fix incorrectly assumed that capability existed. A plain early
return would skip the remaining work, and catching later errors in the current
synchronous flow would not remove the wait or prevent a client timeout.

## Options discussed, not approved for implementation

1. Keep a single synchronous request: investigate and reduce the slow backend
   operations; increase Android's timeout if necessary. Increasing the timeout
   alone does not establish or fix the cause of the delay.
2. Split the API: have Android save the actor's relationship and display success,
   then issue a separate request for feed seeding/synchronization and the
   follower-side update. This requires client changes. Closing the app or losing
   connectivity between requests can leave the remaining work incomplete.
3. An early response with backend background work would require adding a new
   mechanism, outside the existing backend capabilities. Reliable completion,
   restart persistence, and ordering of successive follow/unfollow updates would
   need to be addressed; this was not selected.

Decoupling completion means tweets and follower counts can lag behind the actor's
following state and can remain incomplete if later work fails permanently.
No timeout changes, API changes, background mechanism, retries, migrations, or
client reconciliation changes were authorized. No tests were run.

## Source locations inspected

- Backend: `toggle_following.js`, `toggle_follower.js`, `node_update_score.js`,
  and `docs/LEITHER_DATA_AND_SYNC_CONTRACT.md`.
- Android repository: `/Users/cfa532/Documents/GitHub/Tweet`.
- Android files under `app/src/main/java/us/fireshare/tweet/`:
  `HproseInstance.kt`, `network/HproseClientPool.kt`,
  `datamodel/HproseService.kt`, `service/TweetWorker.kt`,
  `viewmodel/UserViewModel.kt`, and `profile/ToggleFollowingButton.kt`.
