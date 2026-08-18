# Tweet backend — Go MApp

A Go rewrite of the JavaScript backend in the parent directory, as a Leither
MApp. It serves Tweet-iOS, Tweet for Android and TweetWeb.

All 68 entries are ported. Entry names, request parameters and response shapes
are unchanged, so clients need no modification.

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
| `store.go` | Mimei database access (open/close/backup, hashes, sorted sets, refs) |
| `model.go` | user and tweet objects |
| `keys.go` | request parameter names and database keys |
| `caps.go` | node operations the Go API does not expose — **read this first** |
| `auth.go` | agent signatures and peer-node app codes |
| `json.go`, `base64.go`, `value.go`, `netaddr.go` | self-contained codecs and helpers |
| `response.go` | the `""` / `v2` / `v3` response envelopes |
| `*_entries.go` | the entries, grouped by area |
| `codec_test.go` | tests for the hand-written codecs (see *Tests* below) |

## Build

The app is uploaded as **source** and compiled by the node's `ixgo` interpreter,
so it cannot be run directly. `go build` is a syntax and type check only:

```bash
cd go && go build ./...
```

`go.mod` exists only for that check. It maps the import path the interpreter
provides, `Leither/lapi`, onto the published module `github.com/3and4/Leither/lapi`.
Leither generates its own manifest at upload time and does not read `go.mod`.

## Deploying

The debug app (`twbe`, AppID `d4lRyhABgqOnqY4bURSm_T-4FZ4`) deploys with the
existing `~/demo/twbe.sh` on gen8, unchanged — the Go sources go in `~/demo/twbe`
exactly where the `.js` files used to, and the script's `uploadapp` / `backup` /
`mimei publish` sequence works as-is. App name comes from the directory name, so
the directory must stay `twbe` to keep the same AppID.

```bash
cd ~/demo && ./twbe.sh
```

Verified working on Leither **V0.23.95**. Five things about this platform are not
in the published docs and were each found the hard way:

**1. The app directory must contain no `.js` files.** Leither builds the app's
entry list from the `.js` basenames it finds, *recursively* — including a
`mmroot/` subdirectory. With any present, the router rejects every request with
`unknown entry` before `RunMApp` is ever called, even though `--dry-run` reports
`type=go`. Confirm with:

```bash
./Leither lpki runapp --local ./twbe health --dry-run -a gen8.key
```

`Available entries: []` is what a Go MApp should show. The static assets that
used to live alongside the JS (`index.html`, `bootstrap.min.js`, …) are parked in
`~/demo/deploy-backups/twbe-static-assets/`; they cannot be served from this app
directory any more.

**2. `ver=cur` serves a stale compile.** After an upload, `cur` kept running the
previous build while the source on disk was current. Numbered versions and `last`
pick up the new code, so run `lapp backup` (which twbe.sh does) and address
`last`. Clients already use `ver=last`.

**3. `twbe.sh`'s `-n ReyCUFHHZmk...` is gen8 itself**, not a separate service
node — `Leither getvar nodeid` on gen8 returns exactly that id. So `./twbe.sh`
alone publishes everything; a second local `uploadapp` is redundant.

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
./Leither lpki runapp --id d4lRyhABgqOnqY4bURSm_T-4FZ4 check_upgrade -v last -a gen8.key
```

### Verified on the live node

| Entry | Result |
|-------|--------|
| `health`, `logging` | correct envelopes |
| `check_upgrade` | `packageId` = `hdF-zawE_0MH0TSVuBvAU_yA0HA` — the same id `dev_upgrade.sh` hardcodes, so Go's `MMCreate` derives mids identically to the JS version |
| `download_upgrade` | same id, legacy bare-string shape |
| `node_update_score` / `node_get_score` | `BEOpenAppDataNode` + `Zaddwithseq` + `Zrank` + `Zscore` |
| `get_provider_ip` | real reachable address via `GetVar` + private-range filtering |

The previous JS app is backed up at `~/demo/deploy-backups/twbe-js-<timestamp>/`;
restoring it is a `cp` back into `~/demo/twbe` followed by `./twbe.sh`.

## Which node handles a request

Clients choose the node they write to. An entry writes to whichever node it was
called on, and refuses only when the account it names is unknown there.

The previous implementation did this differently: each write entry began by
comparing `user.hostIds[0]` against the current node and, if they differed,
forwarded the whole request onwards. That forwarding was legacy and has been
removed from all 21 entries that carried it. What remains at the top of those
entries is the account existence check that accompanied it, in `routing.go` as
`requireKnownUser` — the error text is unchanged, since clients match on it.

The consequence worth knowing: nothing now stops a write landing on a node that
does not own the account, so a client calling the wrong node will produce a
change that synchronisation later discards. Choosing correctly is the client's
responsibility.

## Limitations to resolve before production

### 1. Node operations with no Go API — `caps.go`

The JavaScript runtime exposed a `lapi` global that is richer than the Go
`lapi.LApi` interface a MApp receives from `GetLApi()`. Seven operations have
**no method on that interface**. This was verified by compiling against
`github.com/3and4/Leither/lapi`:

| Operation | Status in Go |
|-----------|--------------|
| `RunMApp` (another node) | declared on `ILApp`, which is not part of `LApi` |
| `MiMeiSync` | replaced by `BEMMSync`, which **is** on the interface |
| `MiMeiPublish` | absent |
| `MiMeiProvide` | absent |
| `MiMeiUnprovide` | absent |
| `MiMeiUnpublish` | absent |
| `MiMeiIsProvider` | absent |
| `Ed25519Verify` | absent |

`RunMApp` was by far the biggest of these in the original — 97 call sites. Most
were intra-app and are now direct Go calls through `callEntry`, needing no node
API at all. The rest were request forwarding, which has since been removed (see
*Which node handles a request* above).

What is left is five calls that genuinely span two owners on two nodes and
cannot be split by the caller:

- `toggle_following` → `toggle_follower` on the followed user's node
- `toggle_bookmark` / `toggle_favorite` → the matching `*_by_user` entry on the
  acting user's node
- `set_author_core_data` → `sync_user`, warming the node an account is moving to
- `node_update_mid_by_score` → `node_get_score` on the object's owner
- `toggle_following` → `get_tweet_id_list`, reading the followed user's tweets

Every one of these funnels through `caps.go`. They are attempted through
`Act(sid, name, args...)`, the interface's generic escape hatch, using the
action names at the top of that file. **If the node does not register those
actions, `Act` returns an error and the operation reports
`errCapUnsupported`.**

Callers already distinguish the two cases:

- Publishing and providing are best-effort replication; those callers log and
  continue, so writes still succeed locally.
- A cross-node call changes the result, so those callers surface the failure.
- Signature verification degrades to checking that the signature is well formed
  — 64 decodable bytes — and logs that it did. **This is deliberately weak and
  is the same degradation the JavaScript version applied** when
  `lapi.Ed25519Verify` was missing. Agent posting should be treated as
  unauthenticated until real verification is wired up.

To resolve: confirm what the deployed node exposes and edit `caps.go` only. No
entry code depends on how these are implemented.

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

### 4. Standard library assumptions

The interpreter provides only part of the standard library. `unicode/utf16` is
**absent** — confirmed by a failed compile on the node — so `json.go` spells out
surrogate-pair handling itself. The code uses only `fmt`, `io`, `errors`,
`strings`, `strconv`, `sort` and `time`. JSON and base64 are hand-written
(`json.go`, `base64.go`) rather than taken from `encoding/json` and
`encoding/base64`, and no `net/http` or `crypto/*` is used anywhere. If the
deployed interpreter does provide the full standard library, `json.go` and
`base64.go` can be swapped for the stdlib versions with no change elsewhere —
`jsonParse`, `jsonStringify` and `base64Decode` are the only entry points.

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
