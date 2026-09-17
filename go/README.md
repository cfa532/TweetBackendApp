# Tweet backend — Go MApp

A Go rewrite of the JavaScript backend in the parent directory, as a Leither
MApp. It serves Tweet-iOS, Tweet for Android and TweetWeb.

All 68 entries are ported. Entry names, request parameters and response shapes
remain compatible. Updated clients negotiate storage support when selecting servers.

## Layout

Leither loads a MApp as a **single package named `lapp`** with one exported
function, `RunMApp`, and routes requests to it by entry name. Everything is one
flat package — no subpackages — because the node compiles the uploaded source
with its own interpreter and subpackage resolution is not something the MApp
format promises.

| File | Contents |
|------|----------|
| `main.go` | `RunMApp` and the entry dispatch table |
| `runtime.go` | per-call context, request parameters, logging, local entry calls |
| `routing.go` | the account check every write entry makes |
| `store.go` | Per-object storage dispatch and the legacy database adapter |
| `file_store.go` | File snapshot core records, membership directories and CID commits |
| `model.go` | user and tweet objects |
| `keys.go` | request parameter names and database keys |
| `caps.go` | node operations the Go API does not expose — **read this first** |
| `auth.go` | agent signatures and peer-node app codes |
| `json.go`, `base64.go`, `value.go`, `netaddr.go` | self-contained codecs and helpers |
| `response.go` | the `""` / `v2` / `v3` response envelopes |
| `*_entries.go` | the entries, grouped by area |
| `codec_test.go` | tests for the hand-written codecs (see *Tests* below) |

## Storage formats

New tweets and comments/replies use File MiMeis. New users and message stores
use Database MiMeis.
Existing records retain their MIDs and storage format. Existing File MiMeis
remain readable and writable through `tweet-file-v1`. A File MiMei contains
`core.json` plus one JSON
file per collection member (`bookmarks/<user-id>.json`, `comments/<tweet-id>.json`,
etc.). Engagement counts come from those directories; an engagement does not
rewrite the tweet core. Native MiMei references are still maintained separately.

The immutable creation extension `us.fireshare.tweet/file-v1/<kind>` selects the
File adapter, and the core envelope validates its schema, kind and MID. Reads
resolve one committed `mm://<mid>:<version>` root. Writes copy that root into
request staging, replace changed entries, flush it, and commit with `MFSetCid`.
Do not follow this with `MMBackup`: that overwrites the root CID on the
LifeAlbum runtime. Explicit backup calls still commit reference-only changes.
On Leither V0.24.23, `MFSetCid` recursively pins the committed DAG itself;
no permanent node-Files copy is needed. Request scratch trees are removed and
never used as read sources. Staging mutations and cleanup still use `FilesRm`
and require its runtime permissions. Old `/tweet-file-work/<mid>` trees are
not automatically removed by this change.

Verified on minipc V0.24.23 (2026-09-17) with a disposable File MiMei:
copy `ipfs/<cid>` into a scratch directory, flush, commit via `mimei setcid`,
then remove the scratch directory. The `last` directory and its file remained
readable, and `ipfs pin ls /ipfs/<root-cid>` still reported a recursive pin.
`FilesStat` accepted `ipfs/<cid>` and rejected `/ipfs/<cid>`. Unpublishing and
removing the fixture's versions then made `last` unavailable as expected.
These CLI probes used node authority; they do not establish that the MApp
author's session can remove staging files. Local regression tests cover File
commit/update/removal failures and unpublish-before-delete ordering.

Username lookup checks both legacy and File identities; discovery failures and
identity conflicts fail the request. Password IDs use the unchanged legacy
algorithm, and binary package containers keep their File type. Existing message
stores retain their format; new stores use Database MiMeis. Existing node File
indexes remain usable; nodes without one use node application data. Deterministic
File identity lookups may allocate uncommitted shells but do not select them for
new records. No existing record is migrated or repaired by this policy.

`health` adds `storageFormats: ["database", "tweet-file-v1"]` and
`creationFormat: "mixed"` with per-object `creationFormats`. File user/tweet payloads add optional
`storageFormat`; the legacy v2/v3 envelopes and social entry names stay intact.
Old server binaries cannot read File objects. Upgrade roots and their serving
nodes together; retain a dual-format server when rolling back other changes.

This branch has compiler/static validation and a live minipc/simulator exercise
covering a new File tweet, favorite, bookmark, File comment, and restart readback.
Before broader deployment, verify the installed interpreter's File commit
visibility, and native references through a one-level cross-node sync. The
LifeAlbum commit behavior is recorded on Leither V0.24.12; the older backend
runtime notes below do not validate this new storage path. Write serialization,
concurrent lost updates, cross-node atomicity and durable retries remain outside
this change. No tests or live probes were run for this refactor.

## Build

The app is uploaded as **source** and compiled by the node's `ixgo` interpreter,
so it cannot be run directly. `go build` is a syntax and type check only:

```bash
cd go && go build ./...
```

`go.mod` exists only for that check. It maps the import path the interpreter
provides, `Leither/lapi`, onto the published module `github.com/3and4/Leither/lapi`.
Leither generates its own manifest at upload time and does not read `go.mod`.
The same rule applies to the other interpreter-provided packages listed below:
local tooling may need ordinary module requirements, but the deployed MApp must
import the exact paths registered by Leither.

## Deploying

Both release (`tweet1`, AppID `heWgeGkeBX2gaENbIBS_Iy1mdTS`) and debug
(`twbe`, AppID `d4lRyhABgqOnqY4bURSm_T-4FZ4`) must use this File-capable Go
source. gen8 is always the publication target. Its public IP is volatile, so resolve it only
through the Cloudflare-managed `gen8.leither.uk` hostname. Do not publish TWBE
from minipc or ksbox and do not pin a resolved gen8 IP in a command or document.
Use the same procedure below for release, replacing `twbe` with `tweet1` and
`twbe.sh` with `tweet1.sh`. Preserve each environment's existing web/download
assets and build the web bundle with its matching AppID. Do not ship tests,
local tooling or signing keys. Keep backups outside the application directories.

Copy the production Go sources into `/home/pi/demo/twbe/` on gen8. The target
directory must stay named `twbe` because its name determines the AppID. Exclude
tests, local module files, and documentation from the MApp package:

```bash
rsync -av -e 'ssh -p 220' \
  --exclude='*_test.go' \
  --include='*.go' \
  --exclude='*' \
  go/ pi@gen8.leither.uk:/home/pi/demo/twbe/
```

Compare at least one changed file hash before publishing, then run the existing
gen8 script. Its `uploadapp` / `backup` / `mimei publish` sequence remains the
authoritative publisher:

```bash
shasum -a 256 go/file_entries.go
ssh -p 220 pi@gen8.leither.uk \
  'shasum -a 256 /home/pi/demo/twbe/file_entries.go'
ssh -p 220 pi@gen8.leither.uk 'cd /home/pi/demo && ./twbe.sh'
```

The final command must report a new numbered version and successful MiMei
publication. Address verification calls by numbered version first, then confirm
that `last` returns the same result. Both must advertise `database` and
`tweet-file-v1` through `health`, with `creationFormat: "mixed"` and per-object `creationFormats`. Verify
serving/root nodes as well; if needed, synchronize only the application MID
from gen8 before checking File tweet and comment reads.

Verified on Leither **V0.23.95** and re-verified on **V0.24.02**.

V0.24.02 renamed CLI flags. `runapp` lost the `-v` shorthand (use `--app-ver`),
`mimei publish` documents `--mid <mid>` (the positional form still works, so
`twbe.sh` is unaffected), and `lapp release` uses `--app-ver`. Six things about
this platform are not in the published docs and were each found the hard way:

**1. `.js` files alongside the Go sources — fixed in V0.24.02.** On V0.23.95,
Leither built the entry list from `.js` basenames found recursively (including
`mmroot/`) and rejected every request with `unknown entry` before `RunMApp` ran.
On V0.24.02 the Go dispatcher answers correctly even while `--dry-run` still
lists the JS basenames, so the web assets (`index.html`, `bootstrap.min.js`, …)
now live in `twbe/` beside the Go sources, which is what the site needs.

**2. `ver=cur` serves a stale compile.** After an upload, `cur` kept running the
previous build while the source on disk was current. Numbered versions and `last`
pick up the new code, so run `lapp backup` (which twbe.sh does) and address
`last`. Clients already use `ver=last`.

**3. `twbe.sh` targets gen8 itself.** gen8's node ID is
`ReyCUFHHZmk0N5w_wxUeEuoY5Xr`; it is not a separate service node. Run
`./twbe.sh` on gen8 after copying the sources into `/home/pi/demo/twbe/`. A
second upload from minipc or ksbox is redundant and is no longer part of the
publication procedure.

**4. `-r` takes one string, separated by semicolons** — not repeated flags, not
`&`, not commas. Repeated `-r` silently keeps only the last, which looks exactly
like an entry ignoring its parameters:

```bash
./Leither lpki runapp --local ./twbe node_get_score -r "aid=<aid>;userid=<mid>;mid=<mid>;version=v2" -a gen8.key
```

Adding `version=v2` is the quickest way to see a failure: entries return the bare
result to legacy callers, so an error otherwise arrives as a bare `<nil>`.

**5. `--local` has no author identity.** `BELoginAsAuthor` fails there with
`5:To be continued`, so every entry that writes returns an error. This is a
local-mode limit only — it works in container mode. Test those with `--id`:

```bash
./Leither lpki runapp --id d4lRyhABgqOnqY4bURSm_T-4FZ4 check_upgrade --app-ver last -a gen8.key
```

**6. A request with no entry is the web root, not an error.** When a browser
opens the domain, Leither renders `~/demo/temp.html` (a Go template filled with
`{{.MID}}` and the provider `{{.Addrs}}`), and the page then fetches
`/mm/<mid>:last/` from the fastest provider. Alongside that, the application is
called with **no entry at all** — the request carries `mid`, `ver`, `author` and
browser headers only. The JavaScript app satisfied this implicitly; a Go MApp
dispatching from a table must handle it, or the browser gets
`unknown entry ""` instead of the site. `serveWebRoot` in `main.go` answers it.

**7. Request parameters must not be logged verbatim.** The JavaScript entries
logged `JSON.stringify(request)` on every failure, which wrote the plaintext
password to the node log on a failed login and a failed profile update (it
travels as its own parameter and inside the `user` blob). `requestJSON` in
`runtime.go` redacts `password`, the password inside `user`, and the `signature`
inside `agentAuth` before logging. Note the node itself still logs stored records
through `[p2p] SyncMDBKVData`, which is outside this app's control.

### Verified on the live node

| Entry | Result |
|-------|--------|
| `health`, `logging` | correct envelopes |
| `check_upgrade` | `packageId` = `hdF-zawE_0MH0TSVuBvAU_yA0HA` — the same id `dev_upgrade.sh` hardcodes, so Go's `MMCreate` derives mids identically to the JS version |
| `download_upgrade` | same id, legacy bare-string shape |
| `node_update_score` / `node_get_score` | `BEOpenAppDataNode` + `Zaddwithseq` + `Zrank` + `Zscore` |
| `get_provider_ip` | real reachable address via `GetVar` + private-range filtering |

Historical JS backups remain at `~/demo/deploy-backups/twbe-js-<timestamp>/`.
Do not restore a database-only backend now that File objects exist. Any rollback
must retain support for both storage formats on roots and serving nodes.

## Which node handles a request

Every account has one root node, `user.hostIds[0]`, and every write to that
account — or to anything it owns — belongs there. Choosing that node is the
client's job: it knows which node owns the account and calls it directly.

A write that arrives anywhere else is **refused**, by `requireRootNode` in
`routing.go`. Performing it instead would write a copy the root never learns
about and the next synchronisation from the root would discard it, losing the
write silently; refusing says so at once. The accompanying existence check,
`requireKnownUser`, still rejects an account this node has never seen, and its
error text is unchanged since clients match on it.

The previous implementation did this differently: each write entry compared
`user.hostIds[0]` against the current node and, if they differed, forwarded the
whole request onwards. That forwarding is gone from all 21 entries that carried
it — the backend does not bounce a misdirected request, because the client is
better placed to address the right node than the wrong node is to relay.

Entries outside that rule, each for a stated reason:

- **`login`** authenticates with reads, so it answers on any node holding a copy
  of the account — a client cannot know the root node before this reply tells it.
  Only the `lastLogin` write that follows is confined to the root.
- **`register`** creates the account, so there is no root node to consult yet.
  The node handling the request becomes it.
- **`set_author_core_data`** writes the profile wherever it was called, which is
  what lets an account move off a node that has since disappeared.
- **`upload_file`** and **`upload_ipfs`** attach a reference to whichever object
  they were given, on the node they were called on. Neither the JavaScript
  version nor this one checks where that object is rooted, so a misdirected
  attachment is still possible here.

What the forwarding left behind is five `RunMApp` calls that genuinely span two
owners on two nodes; they are listed under *caps.go* below.

## Limitations to resolve before production

### 1. Node operations missing from the published interface — `caps.go`

The JavaScript runtime exposed a `lapi` global richer than the Go `lapi.LApi`
interface a MApp receives from `GetLApi()`. The methods are not actually
missing from the node: at runtime the handle is a `*frame.LApi`, and that
concrete type carries them. They are simply absent from the interface the value
is typed as, and from `github.com/3and4/Leither/lapi` at every published
version.

`caps.go` therefore asserts the handle to a small locally declared interface,
one per operation. Signatures were read off a live node with
`fmt.Sprintf("%T", ...)` and match the JavaScript call sites exactly, including
the `""` second argument meaning "all DHTs".

| Operation | Status on V0.24.02 | JS call it mirrors |
|-----------|--------------------|--------------------|
| `MiMeiSync` | works | `MiMeiSync(sid, "", mid, {})` |
| `MiMeiPublish` | works | `MiMeiPublish(sid, "", mid)` |
| `MiMeiProvide` | works | `MiMeiProvide(sid, "", mid)` |
| `MiMeiUnprovide` | works | — |
| `MiMeiUnpublish` | works | — |
| `MiMeiIsProvider` | works | `MiMeiIsProvider(sid, mid)` |
| `RunMApp` (another node) | works | — |
| `Ed25519Verify` | **absent under every spelling tried** | — |

Why an assertion rather than importing the package that declares them:
`Leither/api` does expose them, but hands back the internal `*frame.LApi`.
Depending on a node's internal type buys nothing the assertion does not, and an
assertion degrades — on a build lacking a method the caller gets
`capUnsupportedError` instead of a compile error or a panic.

`RunMApp` was by far the biggest of these in the original — 97 call sites. Most
were intra-app and are now direct Go calls through `callEntry`, needing no node
API at all. The rest were request forwarding, which misdirected writes no longer
receive (see *Which node handles a request* above).

What is left is five calls that genuinely span two owners on two nodes and
cannot be split by the caller:

- `toggle_following` → `toggle_follower` on the followed user's node
- `toggle_bookmark` / `toggle_favorite` → the matching `*_by_user` entry on the
  acting user's node
- `set_author_core_data` → `sync_user`, warming the node an account is moving to
- `node_update_mid_by_score` → `node_get_score` on the object's owner
- `toggle_following` → `get_tweet_id_list`, reading the followed user's tweets

Callers distinguish best-effort work from work that changes the answer:

- Publishing and providing are best-effort replication; those callers log and
  continue, so writes still succeed locally.
- A cross-node call changes the result, so those callers surface the failure.
- Signature verification degrades to checking that the signature is well formed
  — 64 decodable bytes — and logs that it did. **This is deliberately weak and
  is the same degradation the JavaScript version applied** when
  `lapi.Ed25519Verify` was missing. Agent posting should be treated as
  unauthenticated until real verification is wired up.

One node-side bug remains relevant here. `SyncMiMei` panics with a bounds error
when an object's only announced providers are the calling node itself — there is
nothing to pull from, and it indexes an empty slice rather than returning an
error. Both `MiMeiSync` and `BEMMSync` reach it, so the choice of API does not
avoid it. `syncIfRemote` skips the call when this node already owns the object,
which is both correct and what dodges the panic.

### 2. `upload_compressed_hls` — extraction step not portable

The chunk-collection half is ported and behaves as before. The final step is
not: the JavaScript version unpacked the archive using Node's `fs`, `os` and
`child_process` modules plus an external `unzip` binary. A MApp has no host
filesystem and cannot spawn processes, so there is nothing to port that onto —
and the Node-only code could not have run under Leither's JS engine either.

Calling it with `finished=true` now returns a clear error naming the assembled
`fsid`, which can be completed with `upload_ipfs` instead. Restoring the
original behaviour needs either archive extraction inside the node or an
external service that does the unpacking.

### 3. Interpreter limits

**No package initialisation.** ixgo runs neither `init` functions nor
package-level `var` initialisers — verified with a probe app: a package-level
struct came back zero-valued and an `errors.New` sentinel came back `nil`. Any
package-level variable is therefore empty at runtime, which compiles fine and
fails silently. This package has none; `entryTable`, `bookmarkKind` and
`favoriteKind` are functions for exactly this reason, and `caps.go` uses an error
*type* rather than a sentinel value. Do not reintroduce one.

**The entry name arrives differently per mode.** In container mode the routing
layer consumes it, so `RunMApp`'s `Entry` argument is empty and the real name is
in `Request["entry"]`; `--local` passes it positionally. `main.go` reads both.
This was the single blocking bug for HTTP serving.

### 4. Interpreter-provided packages

Leither does not expose an unrestricted Go module environment. Its ixgo runtime
registers an allowlist of packages that MApp source may import. In addition to
the small standard-library set already exercised by this port (`errors`, `fmt`,
`io`, `sort`, `strconv`, `strings`, and `time`), the following imports are
confirmed available:

| Import path | Conventional alias | Purpose |
|-------------|--------------------|---------|
| `bytes` | `bytes` | Byte buffers and readers |
| `encoding/gob` | `gob` | Go value encoding used by typed Leither results |
| `fmt` | `fmt` | Formatting and errors |
| `io` | `io` | Stream interfaces and helpers |
| `net/http` | `http` | HTTP clients, requests, responses, and handlers exposed by the runtime |
| `os` | `os` | Runtime-exposed operating-system types and operations |
| `strings` | `strings` | String processing |
| `time` | `time` | Time values and durations |
| `Leither/lapi` | `lapi` | Leither's in-container API surface |
| `github.com/hprose/hprose-golang/v3/rpc/core` | `core` | Hprose RPC core types |
| `github.com/hprose/hprose-golang/v3/rpc/websocket` | `websocket` | Hprose WebSocket transport |
| `github.com/shirou/gopsutil/disk` | `disk` | Disk statistics exposed to the interpreter |
| `github.com/shirou/gopsutil/mem` | `mem` | Memory statistics exposed to the interpreter |

Package availability means that Leither registers the import; it does not make
the MApp equivalent to a native Go process. The interpreter restrictions above
still apply, especially the absence of package-level variable initialisation and
`init()` execution. Libraries that depend on those mechanisms can import and
compile yet behave incorrectly, so every required library operation must be
probed on the deployed Leither version.

Earlier V0.23.95 probes found several common packages missing, including
`unicode/utf8`, `unicode/utf16`, `encoding/base64`, `crypto/*`, and `regexp`.
Those results are version-specific. In particular, the earlier conclusion that
`bytes` and `net/http` were unavailable is superseded by the current confirmed
allowlist. This backend still keeps its hand-written JSON and base64 adapters to
avoid changing established behavior; their existence should not be read as the
current runtime's complete package inventory.

## Behaviour preserved deliberately

These look like defects but are reproduced on purpose, because clients depend on
the current shapes. Each is commented at its site.

- **`get_tweet` with `version=v3`** returns `[tweet, [originalTweet]]`. The
  quoted tweet is fetched with `version=v3` too, so it arrives already wrapped in
  its own one-element list and is appended nested. Changing it would change what
  v3 clients parse.
- **`add_tweet` attachment timestamps.** The original coerced
  `attachment.timestamp` to a number *after* storing the tweet, so the coercion
  never reached storage. The order is kept; attachment timestamps are stored as
  the client sent them.
- **Unbracketed IPv6 parsing** in `splitHostPort` — see the comment there.
- **Envelope differences per entry.** Most entries wrap only for `v2` and hand a
  `v3` client the bare value; a few wrap errors for `v3` as well; `register` and
  `toggle_following` treat a missing `version` as `v2`. `response.go` names each
  variant and every entry keeps the one its predecessor had.

## Invariants worth knowing

From `docs/LEITHER_DATA_AND_SYNC_CONTRACT.md`, which this port follows:

- A user object is authoritative on `user.hostIds[0]`. Every write to a user, or
  to anything they own, belongs on that node — writing to a local replica
  produces a change that the next synchronisation discards.
- A tweet lives on its **author's** root node. A comment lives on its **parent
  author's** root node, whoever wrote it.
- Creating a child object must add a Mimei reference from its parent
  (`MMAddRef`), and deleting must remove it (`MMDelRef`). Leither carries one
  level of references when it synchronises an object, and that is what makes a
  user's tweets travel with the user. The sorted lists used for pagination do
  **not** replace references; both are maintained.
- Writes go to Mimei version `cur`, reads to `last`, and a write is only visible
  after `MMBackup`.

## Tests

```bash
cd go && go test ./...
```

`codec_test.go` covers the hand-written JSON codec (round-tripping, integer
formatting, key ordering — which agent signatures depend on — and rejection of
malformed input), base64 decoding in both alphabets, address filtering, and the
value coercions. It does not test the entries themselves; those need a running
node.

Go excludes `_test.go` files from ordinary builds. If the node's interpreter
turns out to compile every `.go` file it finds, delete `codec_test.go` before
uploading.

## Imported CID attachments

`pin_ipfs` accepts `userid` (the attachment owner's account), a bare `cid`, and
`version=v2`. Call it on that account's root node before submitting a tweet or
attachment edit. It waits for `IpfsPinAdd(authorSession, false, "/ipfs/" + cid)`
and returns `{success: true, data: {cid, pinned: true}}` only after direct
pinning succeeds. Errors, including an unavailable pin capability, return the
v2 failure envelope. The pin has no expiry and is independent of tweet references. It matches
`Leither ipfs pin add <cid>` without `-r`; it does not recursively retain linked
blocks or HLS segments.

Deploy this backend entry before the Web editor update. The editor blocks
submission when pinning cannot be confirmed and keeps the draft for retry.
Existing tweet attachments are not migrated or pinned retroactively. The
existing upload, create and edit API contracts for sibling clients are unchanged.
