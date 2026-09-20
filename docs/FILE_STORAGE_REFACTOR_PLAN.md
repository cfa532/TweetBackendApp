# Go File-type storage and iOS compatibility plan

Status: implemented on the backend and iOS `codex/file-storage-refactor` branches on 2026-09-12. Compiler/static validation only; not deployed. See `README.md` for the implementation and remaining runtime checks.

## Governing principle

Store rarely changed data in a file. Represent frequently changed collections as directories containing individual entries. A tweet's content, attachment CIDs and attachment metadata belong in its core JSON file; comments, bookmarks, favorites and retweets belong in collection directories. Updating a collection does not rewrite the core file.

An existing user or tweet retains its original storage format and MID for all future reads and updates. Every user or tweet newly created by the refactored backend uses File type. The object's own format selects its adapter; the age or format of its author does not. There is no conversion on edit, bookmark, login or other access.

Write serialization is explicitly deferred. Preserve the existing backend's concurrency behavior for this refactor; do not add locks, a writer coordinator, a native service or a concurrency-related release prerequisite. The storage change does not claim to solve concurrent lost updates or cross-node atomicity.

## Branches and scope

- TweetBackendApp: `codex/file-storage-refactor`, created and checked out from local `main` at `0ac36fc0cb7fe830877fa7b2380ac3099cac28d2`. This main already includes the JavaScript bookmark fixes.
- Tweet-iOS: `codex/file-storage-refactor`, created from local `main` at `9fe95b6b959714ba49e1525b08b8a5b9073ccb66`. It is checked out in `/Users/cfa532/Documents/GitHub/Tweet-iOS-file-storage-refactor`. The existing `root-node-writes` checkout, its seven commits ahead of main, and its two modified project/workspace files are preserved. Use a separate checkout for implementation and review any necessary fixes from that branch individually.
- Refactor application-owned Go persistence: users, tweets/comments, social and saved-item lists, feeds, messages and node indexes. Existing media already uses File/IPFS operations and should not be re-encoded.
- Keep JavaScript as the legacy implementation. Do not make it understand File storage in this work.
- New-format authoritative application data must use File-type MiMei. Database calls remain only inside the explicit legacy adapter. Do not leave node scores or other new-format metadata hidden in `BEOpenAppDataNode` databases.

## Findings from the sources

Leither's [MiMei API](/Users/cfa532/Documents/GitHub/Leither/api/MiMei.md) distinguishes File and Database types but shares identity, permissions and version APIs. `cur` is writable, `last` is committed, and `MMBackup` advances `last`. The current [Go interface](/Users/cfa532/Documents/GitHub/Leither/lapi/stub.go) exposes byte I/O, truncation, node Files operations, and `MFSetCid`. The repository contains API interfaces rather than the internal commit implementation; it does not establish compare-and-swap or cross-request locking guarantees.

LifeAlbum demonstrates two different, valid File storage strategies:

1. [Profile records](/Users/cfa532/Documents/GitHub/LifeAlbum/apps/lifedrive-server/profile_entries.go): create a File MiMei; encode JSON; write with `MFSetData`; check the byte count; truncate; update references; commit using `MMBackup`.
2. [Drive snapshots](/Users/cfa532/Documents/GitHub/LifeAlbum/apps/lifedrive-server/mutation_entries.go): assemble a directory tree; `FilesFlush` returns its CID; `MFSetCid` commits that CID and returns the version. Its source records that adding `MMBackup` after `MFSetCid` can overwrite the committed tree with empty content. These commit paths must never be combined.

LifeAlbum's [data model](/Users/cfa532/Documents/GitHub/LifeAlbum/docs/LIFEDRIVE_DATA_MODEL.md) and [native identity service](/Users/cfa532/Documents/GitHub/LifeAlbum/apps/lifedrive-identity/main.go) also discuss or implement concurrency controls. Those controls are outside this refactor, per the user's direction.

Tweet's current [storage helpers](/Users/cfa532/Documents/GitHub/TweetBackendApp/store.go) implement scalars, hashes, sorted sets and sequence numbers. Some entries bypass those helpers with direct hash/sorted-set calls. A type-constant replacement would leave all those calls incompatible with the new objects.

iOS accesses social data through backend entries, not directly through Leither database APIs. Its API response versions (`v2`/`v3`) are distinct from the proposed disk schema. This lets both storage formats produce the same existing User/Tweet records.

## Recommended architecture

Use **one File MiMei per existing logical ownership boundary**, with rarely changed records stored as files and frequently changed collections represented by directory entries. Keep a user, a tweet, a comment/reply and a user's message store as independently addressed objects. Node-local indexes use a separate File MiMei scoped to the application and node.

Alternatives considered:

| Approach | Assessment |
|---|---|
| One JSON blob for every field/list of an object | Closest to LifeAlbum profiles, but every bookmark rewrites and decodes the entire membership list. Poor fit for large social objects. |
| One File MiMei for the whole application or user plus all descendants | Convenient commits, but breaks independent tweet identity, comment ownership and the existing one-level synchronization model. |
| Core JSON file plus one file per collection entry | Selected. Adding/removing an engagement changes its directory entry while retaining the core file and other entries. No paged JSON membership database or duplicate ordering index. |

Proposed tree (paths and schema name are new-format internals):

```text
<tweet MID>/
  core.json                    schema, MID, owner, content, attachment CIDs and metadata
  comments/<commentId>.json    comment ID, writer ID, existing ordering metadata
  bookmarks/<userId>.json      user ID and saved-at timestamp
  favorites/<userId>.json      user ID and favorited-at timestamp
  retweets/<retweetId>.json    retweet ID, user ID and existing ordering metadata

<user MID>/
  core.json                    schema, MID, profile and other account fields
  tweets/<tweetId>.json
  bookmarks/<tweetId>.json     tweet ID and saved-at timestamp
  favorites/<tweetId>.json
  following/<userId>.json
  followers/<userId>.json
  comments/<commentId>.json
  pinned/<tweetId>.json        explicit existing rank/order value
  blocked/<userId>.json
```

Each collection entry is a small JSON file keyed by its unique membership ID. Existence is membership; its contents hold the metadata needed by that list. Retweets retain the existing retweet-ID key rather than collapsing multiple retweets into one user-ID entry; their payload identifies the user. Comments remain independent Tweet objects, and the entry in the parent directory contains their reference/ordering metadata rather than a second copy of their core content.

The root snapshot includes the unchanged core file and changed collection directories. A bookmark updates only its entry; a core edit updates only `core.json`. The object version/root CID changes on commit, while unchanged child file CIDs are reused. These directories are internal to the same MiMei, so they add no MiMei reference-synchronization depth. Separating core and collections does not require separate publicly addressed MiMeis.

Use explicit `schema: "tweet-file-v1"` and object `kind`. Keep MiMei MID stable across revisions; never expose a revision CID as `tweet.mid` or `user.mid`. Preserve integer timestamps/sequences exactly through JSON and preserve unknown record fields that the current map-based models retain.

### Lists, ordering and counters

- User bookmarks: unique tweet ID mapped to saved-at time.
- Tweet bookmarks: unique acting-user ID mapped to saved-at time.
- Following/followers, favorites, reply history and block lists keep their existing membership/value meanings.
- Store the existing score/time/rank in each entry and sort it when listing. Define equal-score tie ordering to preserve current behavior rather than relying on filesystem enumeration order. Node update scores retain monotonic sequence semantics; their sequence state is a small frequently updated metadata file, not a replacement wall-clock score.
- For the initial layout, use one file per entry. Do not introduce page manifests, page splitting or a duplicate by-order index. Directory listing/metadata-read cost for large collections is an explicit performance consideration; measure it before adding any partitioning.
- Derive counts from committed directory membership. Adding a bookmark creates one user entry; removing it deletes that entry. Do not rewrite `core.json` or persist a second bookmark count.
- Preserve existing `pn`/`ps` pagination and each endpoint's nil-slot/filtering behavior. Read a committed directory, obtain its ordered entries and apply the requested slice. Cursor-protocol changes are outside this refactor.
- Repeated explicit add/remove operations check entry existence and retain the current no-op semantics, including not changing saved-at time for an already-present bookmark.
- Decode errors are errors, not evidence that membership is absent. Do not repair invalid collection entries during normal reads.

## Commit algorithm

1. Resolve the object's format, validate caller permissions and require its authoritative root node. A request parameter cannot override the stored object's format or owner.
2. Read the committed snapshot. Preserve the current request execution/concurrency model; introduce no locks or serialization mechanism.
3. Apply the requested change to that committed state, not leftover staging content. Explicit set/unset semantics remain the default for bookmark/favorite operations.
4. Assemble a staging tree for this request from the object's committed snapshot. Copy/link unchanged content. For a core edit, replace the core JSON file. For a collection change, add, update or remove only the relevant directory entry. Check byte-write counts and truncate any reused byte file to its new length.
5. Apply required native MiMei reference changes using the reference/commit ordering established by the runtime proof below. JSON directory entries do not substitute for native references.
6. Flush that staging tree and commit its CID using `MFSetCid`. **No subsequent `MMBackup` on this object.** Capture the returned committed version.
7. Publish according to Tweet's existing public/private policy, then return the existing normalized API result. Propagate failures through the current error contract rather than claiming success.
8. Promote the committed request tree to the object's stable node-Files retention path, then retire the request's scratch tree. Normal reads still use the committed MiMei URL rather than staging. Retaining that stable tree keeps the committed DAG available across requests and process restarts. This does not introduce durable operation receipts or new retry guarantees.

Normal reads pin a single immutable version/root for the duration of the request, so core data, membership flags, counts and lists come from the same committed snapshot. Access-node reads stay ordinary local reads. User-requested `resync_user`/`refresh_tweet` remain explicit recovery operations.

### Serialization is deferred

Per the user's instruction, this phase adds no locks, expected-version concurrency protocol, native coordinator or single-writer prerequisite. Concurrent updates can still race; a File snapshot commit does not by itself prevent lost updates. Leave that limitation explicit for a separate future concurrency change.

### References and synchronization

Preserve the [canonical contract](/Users/cfa532/Documents/GitHub/TweetBackendApp/docs/LEITHER_DATA_AND_SYNC_CONTRACT.md): user references own tweets; parent tweet/comment references direct comments/replies; comment storage uses the parent's storage ownership rule. Maintain `MMAddRef`/`MMDelRef` in addition to JSON list entries. Preserve media retention and explicit pull-to-refresh recovery.

LifeAlbum's private drive policy cannot be copied: Tweet still needs publication, providers and cross-node synchronization. The interaction between native references and `MFSetCid` is a **release gate**, not an assumed atomic guarantee. Verify that a new snapshot exposes the intended references and carries exactly one child layer when synchronized. If the runtime cannot safely commit those together, obtain a supported Leither commit mechanism before shipping this layout; do not hide the missing guarantee with a read-time repair.

### Operations spanning nodes

File storage does not make a bookmark's tweet-side and user-side commits atomic.

Preserve the existing two-step flow: update the tweet's membership directory on its storage node, then update the user's saved-item directory on the user's node. Each side uses its own format adapter. Retain explicit desired-state requests and existing error handling. Apply the same storage substitution to follows, messages and parent/child updates.

Do not add an outbox, durable operation receipts, a background delivery service, distributed rollback or a new pending-operation API in this storage refactor. A failure after the first commit can still leave the two sides different. Do not retry a timed-out mutation through a different storage algorithm.

## Existing data and identity

The format policy is **existing objects unchanged; new users and tweets use File type**:

- Existing Database objects keep their MIDs and use the legacy adapter for reads/writes.
- Every new user and tweet created by the refactored backend uses File storage. This includes new tweets created by existing database-backed users. Comments/replies are Tweet objects and follow the same new-object rule while retaining their existing storage-owner routing.
- Updating an existing database-backed user or tweet continues to write its database. For example, when an existing user creates a File tweet, the user's tweet list/reference is updated through the database adapter; the new tweet's core file and directories use the File adapter.
- Engagements dispatch independently for each object. An existing user bookmarking a new File tweet updates the user's database and the tweet's bookmark directory. A new File user bookmarking an existing tweet updates the user's bookmark directory and the tweet's database.
- Select the adapter from verified MiMei metadata (`mminfo` exposes data-type information in the current Go types), then validate the File schema. Confirm the actual metadata encoding on the target node. A failed read is not proof of another format and must not trigger creation or fallback writes.
- New user/message File objects use purpose-specific creation extensions/marks. Existing username lookup must still find old accounts. Check both legacy and new deterministic identities before registration; a network/permission failure is not evidence that a username is free. If both identities resolve inconsistently, return a conflict instead of guessing.
- Do not change the existing password-derived identity/authentication algorithm as part of the storage conversion.
- Keep media IDs, parent/original IDs, shared URLs and local cache identities unchanged for existing objects. There is no supported in-place Database-to-File conversion established by the sources inspected.
- Migration and format conversion are outside this refactor. Do not add migration-on-write, replacement MIDs or alias mappings for existing users/tweets.

Old server binaries cannot read File objects and continue to create Database objects. Those objects remain supported as legacy data. The new-object File rule applies to the refactored backend; iOS compatibility with old servers does not change their storage behavior. Deploy new creation paths only on capable roots. If rollback is necessary, pause new creation while keeping a dual-format server serving already-created File data; do not silently switch the refactored backend back to Database creation.

## iOS compatibility

Keep the existing `RunMApp` entries and current User/Tweet payloads. Disk layout belongs in the server adapter, not in Swift or UI models.

1. Extend the existing `health` reply with additive storage capabilities: readable/writable formats, the creation format and supported disk schemas. The refactored backend reports File creation; it does not offer per-user or per-request Database creation. Keep `success`/`message` so old callers continue to work.
2. Cache capabilities by node and app identity/version, not globally or by Debug/Release build. A valid old health response with no capabilities means legacy. Network failure remains unknown/unavailable, not legacy.
3. Add optional storage-format metadata to Swift transport records only where routing requires it. Use `Records.swift` value snapshots across concurrency boundaries; merge observable models on the main actor. Existing cache records lacking the new fields remain readable.
4. Choose a capable access node for reads involving File objects or mixed-format collections; otherwise use the known capable root with ordinary read entries. This is routing, not forced synchronization. Negotiate before dispatch rather than retrying arbitrary failures against another server.
5. Preserve current mutation requests, optimistic UI updates and response handling. Do not add operation IDs, persistent retry queues or a new concurrency protocol as part of storage compatibility.
6. Legacy servers keep the current request/response behavior. Preserve existing model IDs and media URLs. Do not issue direct File I/O from iOS and do not dual-write from the client.

Compatibility target:

| iOS | Serving backend | Data | Behavior |
|---|---|---|---|
| Updated | Old JS/Go | Database | Existing behavior |
| Updated | New Go | Database | Legacy adapter; unchanged IDs |
| Updated | New Go | File or mixed | File/legacy dispatch; storage capability routing |
| Existing | New Go | Supported data through current API | Existing payloads; no new pending-success envelope |
| Any | Old JS/Go | File | Unsupported; route to upgraded serving nodes |

For old callers, incomplete cross-node work remains a failure rather than a success payload they would misinterpret. Existing Android/Web retain the current API contracts on upgraded nodes; their ability to choose upgraded providers during a mixed deployment must be assessed before broad enablement. Their source is not changed in this phase.

## Implementation sequence

1. **Runtime and contract proof.** Establish metadata/type detection, creation identity rules, exact File APIs, directory-entry operations, commit/references semantics, read-version pinning and authorization on the target Leither build. Serialization is excluded. Record supported storage capability requirements. No live probes have been run for this plan.
2. **Storage boundary.** Introduce focused legacy and File adapters, a format resolver and normalized object/list operations. Move all direct database calls behind the legacy boundary, including message storage, node scores and feed indexes. Preserve existing response envelopes and unknown fields.
3. **First vertical slice.** Implement tweet core JSON creation/read/edit plus its parent directory-entry/reference update. Add bookmark/unbookmark as entry creation/removal on both owners; derive counts from membership and confirm the tweet core file stays unchanged. Exercise a legacy user bookmarking a File tweet as the mixed-format design case.
4. **iOS dual compatibility.** Implement storage capability discovery and capable-node routing while preserving the current payloads and interaction behavior. Work in the new main-based branch using a separate checkout; do not move unrelated current changes.
5. **Complete backend coverage.** Convert new users, profile/social/pinned/block lists, comments/replies, feeds, messaging and node indexes. Keep legacy reads/writes operational and preserve media upload paths.
6. **Controlled rollout.** Deploy the dual-format backend and compatible iOS routing to selected roots and their serving nodes. New users/tweets on the refactored backend use File type from the start; updates to existing objects retain their format. Broaden deployment after compatibility validation. No migration or format conversion is included.

## Validation and completion criteria

During implementation, perform static review, Go compiler checks and iOS builds. Per repository instructions, do not run tests or runtime probes without explicit user authorization. Proposed runtime validation, once authorized, covers core-file edits, unchanged core CID after engagement updates, entry add/remove/no-op behavior, short writes, commit/read visibility, ordering/counts, permission denial, references/sync, large-directory listing cost and mixed JS/Go deployments. Concurrency guarantees and restart-safe delivery are not acceptance criteria for this phase. A normal Go build cannot establish interpreter API availability or durability.

Complete when rarely changed data is stored in core files; frequently changed collections use individual directory entries; engagement changes do not rewrite tweet core data; new-format application data uses File storage; legacy data remains usable; one-level references and recovery APIs work; paging/counts reflect committed membership; iOS operates against both old and new nodes; and rollback preserves access to already-created File objects.

Implementation follows this plan and is not deployed. No tests or live probes were run; no data was migrated. Storage identity and commit/reference behavior still require verification; serialization and distributed-operation redesign are explicitly deferred.


## Implementation notes

- `file_store.go` implements per-request File snapshots; `store.go` dispatches
  each record/list operation by the opened object's creation metadata. Direct
  hash/sorted-set bypasses in entry functions now use that boundary.
- File cores exclude client-provided engagement counts and membership lists.
  Collection entry files contain `id`, optional `value`, and optional `score`.
  Scores and sequence high-water marks are stored as decimal strings to preserve
  int64 precision; the API still returns numeric scores.
- New message stores use File storage even for legacy users. Both deterministic
  identities are checked for conflicts. Existing message databases remain in place.
- Existing node score entries keep their database location and value. A newly
  tracked score goes into the node's File index. The node's legacy system session
  is retained for peer RPC authorization; it is not used to store new score entries.
- New backup calls commit reference-only changes as well as content changes.
  Read-only score lookups do not create redundant File versions.
- Bookmark/favorite failures on the user side now propagate rather than returning
  a profile as apparent success. Deletion removes saved entries from the correct
  bookmark/favorite hash collections for both formats. This does not repair
  previously persisted stale entries.
- iOS caches health capabilities per endpoint/app/version for 60 seconds and
  carries optional storageFormat through records, singleton merges and cache
  encoding. Known File objects require a capable server. Ordinary reads may use
  a known capable root when the selected access node is legacy; explicit recovery
  and mutation calls keep their requested target. User route confirmation records
  the server that actually answered.
- Mixed-deployment discovery still requires upgraded entry/provider nodes for
  File accounts that the client has never seen: an old backend cannot derive the
  new account identity or describe an unknown File object's owner. Android/Web
  keep their payload compatibility on upgraded servers, but their provider
  selection has not been changed here.


## Validation results (2026-09-12)

- Go: `go build ./...` passed, and both repository diffs passed whitespace checks.
- iOS: Debug device-target Swift compilation and linking completed. Final bundle
  validation failed because all eight bundled FFmpeg frameworks lack Info.plist
  files. Retrying with VALIDATE_PRODUCT=NO did not bypass Xcode's final validator.
  No packaging workaround or unrelated dependency changes were added.
- Tests and live Leither probes were not run, per the user's workflow preference.
  The File commit/native-reference and interpreter checks above remain required
  before deployment. No deployment, migration, commit or push was performed for
  this implementation.
