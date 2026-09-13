# Backend session identity audit — 2026-09-13

The reported `5031:mmsid is a data-area session, not a login identity`
errors came from passing `MMOpen` or `BEOpenAppDataNode` handles to APIs
that act under a login identity. This applies to both storage formats. Only the Go backend is active; JavaScript is deprecated.

## Session contract

| Operation | Session to pass |
| --- | --- |
| Create/open an object, backup a database object, add/remove references, delete versions | Author login from `BELoginAsAuthor` (`authSid` in Go) |
| Publish, unpublish, provide, unprovide, synchronize, provider lookup | Login identity |
| Cross-node `RunMApp` request `sid` | Login identity |
| Database `Get`/`Set`, hash and sorted-list operations | Open object's data handle; node score operations retain the node data handle |
| Read/write an opened file or upload | The corresponding file handle |
| Files staging, `FilesFlush`, and `MFSetCid` | Login identity |

Public reads that already accept an empty identity retain that behavior.
Login identities are not obtained by opening an object's data area.

## Corrections

Reviewed production Go API wrappers and their callers and File storage.
Corrected remaining identity arguments in
tweet/comment creation and deletion, attachment references, feed refresh and
its partial-write persistence, engagement, profiles, avatars, moderation,
messages, uploads, and score synchronization.

The Go backup helper now accepts a login identity consistently. It still
commits an open File object's staged state through `commitFile`; database
objects use `MMBackup`. File commits retain `FilesFlush` then `MFSetCid`,
without an additional `MMBackup`. Object routing and parent reference/list
ordering remain as before. No error is reclassified as success and no
automatic repair or migration was added.

## Validation and limits

Go compilation and formatting checks passed. No remaining data-handle
arguments were found in the audited Go identity calls. JavaScript changes
are excluded because that implementation is deprecated.

No tests or live write probes were run. Compilation does not verify behavior
inside the deployed Leither interpreter. Earlier failed writes or publication
attempts may have left partial state; this audit does not establish or repair
the persisted state of those objects.

The local Leither API reference (`../Leither/api/MiMei.md` relative to the
TweetBackendApp repository root) documents login sessions for `MMBackup`, `MMAddRef`,
`MMDelRef`, and `MMDelVers`. The supplied runtime logs establish the same
requirement for remote calls and unpublish.
