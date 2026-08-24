# Leither Go MApp — issues

Found porting a 68-entry backend from JS to Go. Reproduced on a live node at
**V0.23.95** and **re-verified unchanged on V0.24.02**, linux/amd64. Probes are
single files run with `./Leither lpki runapp --local <dir> x -a gen8.key`.

Re-verification method improved: P2/P3/P7 were originally checked by compiling
against the published `github.com/3and4/Leither/lapi` module. They are now
confirmed by compiling calls against **the node's own interpreter-registered
`lapi`**, which is the authoritative surface. All seven remain absent.

**Not a problem:** the Go language implementation. A conformance probe covering
defer ordering, named-return-defer, panic/recover, per-iteration loop capture,
interfaces, type switches, embedding with pointer receivers, `errors.Is/As`+`%w`,
slice 3-index aliasing, 50 goroutines with WaitGroup/Mutex, channels+`select`,
rune ranging and method values passed completely. Everything below is runtime
integration and library surface.

---

## P1 — Package-level `var` initialisers and `init()` never run

`const` works; every `var` is its zero value.

```go
const c = 7                    // -> 7   ok
var i = 42                     // -> 0
var s = "literalOK"            // -> ""
var sl = []int{1, 2, 3}        // -> []
var f = makeVal()              // -> ""
func init() { x = "initOK" }   // -> ""   never runs
```

Compiles clean, fails silently, and package-level `var` is ordinary Go — most
real code and most libraries use it. Caused two faults here: a dispatch table
built in `init()` was empty so *every* entry was unknown; and two structs holding
database key names were zero, which would have written user data under **empty
key names** instead of erroring.

Fix on our side: no package-level vars at all. Tables/structs come from
functions, and an `errors.New` sentinel became an error *type* (a package-level
sentinel is `nil`, so `errors.Is` against it silently misclassifies).

## P2 — No way to publish or provide → written content never reaches the network

`MiMeiPublish`, `MiMeiProvide`, `MiMeiUnprovide`, `MiMeiUnpublish`,
`MiMeiIsProvider` exist as CLI commands but nowhere in the Go API — not in
`lapi`, not in `api/MiMei.md`.

A MApp can therefore write but never announce. A new account, tweet or comment
is stored and readable on its own node and invisible everywhere else, while the
write reports success. Live:

```
[mapp][W] Tweed login: publish iq1w-iqAbwGsZX653vV0lL1PL_D failed:
          mimeipublish: 5020:Variable names unavailable:mimeipublish
```

`MMRelease` is not a substitute (per `api/MiMei.md` §1.5 it designates an
existing version as the release). `BEMMSync` covers only the pull direction.

**This is what currently makes the port non-viable in production.**

## P3 — `RunMApp` is absent from `LApi`

Declared on `ILApp`, which `LApi` does not embed, so a MApp cannot call another
node or another app. Five operations here inherently span two owners on two
nodes and cannot be split by the caller — e.g. a follow writes to both users'
accounts, which live on different nodes.

## P4 — `Entry` is empty in container mode

Under `--local`, `RunMApp`'s `Entry` carries the entry name. Under `--id`/HTTP it
is empty; the name is only in `Request["entry"]`.

This contradicts the documentation — `examples/echo` states *"`Entry` 是入口名,
对应 CLI 的位置参数或 URL 的 `?entry=xxx`"* — and **both official examples
(`hello`, `echo`) dispatch on `switch Entry`**, so both serve nothing once
deployed. `mapp-development.md` lists it under troubleshooting with the advice
"use `--local` for development", but for a single-entry-point Go MApp this is the
difference between serving requests and not.

Filling `Entry` from the same source in both modes removes the trap.

## P5 — `.js` files anywhere in the tree disable a Go app's routing

Leither builds the entry list from `.js` basenames found **recursively**,
including `mmroot/`. With any present, the router rejects every request with
`unknown entry` before `RunMApp` runs — while correctly identifying the app as Go:

```
Dry run: app=twbe entry=health type=go (valid)
  Available entries: [bootstrap.min gtag hprose index_entry popper.min ...]
  Has Go sources: true
```

`Has Go sources: true` with a JS-derived entry list is contradictory. Practical
effect: a Go MApp cannot ship static web assets. Removing them gives
`Available entries: []` and the app works.

## P6 — Interpreter package coverage is versioned and allowlisted

The table below records the original Leither V0.23.95 probe and should be read
as historical evidence, not as the current package inventory:

| Resolves | Missing |
|---|---|
| `fmt` `io` `errors` `strings` `strconv` `sort` `time` | `bytes` `unicode/utf8` `unicode/utf16` |
| `encoding/json` `math/big` `sync` `os` | `encoding/base64` `crypto/*` `regexp` `net/http` `encoding/gob` |

**The published allowlist does not match the runtime.** `LEITHER_AND_MIMEI.md`
§9.2 lists `bytes`, `net/http` and `encoding/gob` as "confirmed available"; all
three are rejected on V0.24.02. It omits `encoding/json`, which resolves. A table
presented as confirmed should be generated from the interpreter's registry, or
carry the exact build it was measured on — an author trusting it would write code
that fails only at upload.

`bytes` and `unicode/utf8` are close to universal in Go. Note `encoding/json`
resolves while `unicode/utf8` does not, though json depends on it internally — so
the boundary isn't "what json needs". Cost here: hand-written JSON and base64
(~470 lines), and `json.go` spells out UTF-16 surrogate pairing.

**Updated package information:** the current Leither program also registers
`bytes`, `encoding/gob`, `fmt`, `io`, `net/http`, `os`, `strings`, `time`,
`Leither/lapi`, Hprose `rpc/core` and `rpc/websocket`, and gopsutil `disk` and
`mem`. The original claims that `bytes` and `net/http` are missing are therefore
superseded for the newer runtime. See `go/README.md` for exact import paths.

Import resolution alone does not guarantee native-Go behavior. The interpreter
still controls package initialization and runtime integration, so required
operations must be exercised on the exact deployed Leither version.

## P7 — No signature verification

No `Ed25519Verify` or equivalent, and with `crypto/*` missing it cannot be done
in-app. Agent authentication in this app is consequently unverified — it checks
only that a signature is 64 well-formed bytes.

## P8 — `Act` resolves nothing

Fails even for a name `GetVar` answers:

```go
l.Act("", "ver")     // ERR 5020:Variable names unavailable:ver
l.GetVar("", "ver")  // V0.23.95
```

`api/VarAct.md` marks it 草 (draft) holding 待定 APIs, so an empty registry is
presumably intended — worth saying plainly in the MApp docs, since `Act` reads
like the extension point for exactly P2/P3/P7. Unchanged on V0.24.02.

## P9 — Unwired backend stubs return `("", nil)`

`BEOpenAppDataNode` and `BELoginAsAuthor` return an empty session **and nil
error** when unwired (`lapi/backend.go`). The empty handle flows onward and dies
far away as `Zaddwithseq(): invalid key size` — reading like a key-length problem
rather than a missing identity. Also `BELoginAsAuthor` fails under `--local` with
`5:To be continued`, so no write entry is testable there.

## P10 — CLI papercuts

- `-r` takes one semicolon-separated string. Repeated `-r a=1 -r b=2` silently
  keeps only the last — indistinguishable from an entry ignoring its parameters.
  `&`, `,` and JSON forms are accepted and ignored.
- `showapp -a <name>` dies on an unrelated object:
  `30000:No MiMei mid[FPrNJIrJUfIbdWtNVirjVfv4pS-]`. `mimei show <appid>` works.
- `runapp --dry-run` requires an entry, so it can't validate an app as a whole.
- V0.24.02 removed the `-v` shorthand from `runapp` without an alias; scripts
  and docs using `-v last` now fail with `unknown shorthand flag: 'v'`. The
  replacement is `--app-ver`. (`mimei publish` kept its positional form, so that
  change was backward compatible — this one was not.)

## P12 — Node memory growth degrades a node into unusability

Observed on minipc (V0.24.02) after ~4 days uptime: the Leither process held
**3.37 GB RSS (42% of RAM)** while using only 5.2% CPU. The node stayed "healthy"
to a `HEAD /` probe but every application call stalled — a `HEAD /` took 10.6 s
and `/entry` calls, including `health` (which does no I/O at all), timed out
beyond 30 s. Static `/mm/` reads still worked intermittently, so the node looked
alive while being useless for applications.

A `systemctl restart leither-tweet` fixed it completely:

| | before | after |
|---|---|---|
| RSS | 3.37 GB | 521 MB |
| `HEAD /` | 10.6 s | 0.25 s |
| `health` | timeout >30 s | 0.34 s |
| `get_user_core_data` | timeout | 0.66 s |
| `get_tweet_feed` (10 tweets) | timeout | 0.29 s |

For comparison, gen8 at 1 day 6 h uptime sits at **87 MB**. The growth is not
proportionate to load and looks like a leak; 3.4 GB is ~39× the healthy figure.

Two things make this expensive to diagnose from the application side:

1. A degraded node is indistinguishable from a slow application. The client's
   only symptom is `PoolTimeoutError ... timed out after 15000ms`, which reads
   as "the app is slow".
2. The node keeps answering health probes while failing every real call, so
   client-side failover never triggers.

An RSS or request-latency figure in `getvar health` would let both operators and
clients act on this.

## P13 — Provider lists hand browsers unreachable private addresses

The domain template publishes every announced address, including
Tailscale CGNAT (`100.64.0.0/10`), VPN (`10.8.0.0/24`), and LAN
(`192.168.5.0/24`). A public page cannot use any of them:

```
Access to XMLHttpRequest at 'http://100.79.13.15:8002/...' from origin
'http://twbe.fireshare.us' has been blocked by CORS policy: The request client
is not a secure context and the resource is in more-private address space `local`.
```

Each blocked or unroutable address still consumes a client connection slot and a
15 s timeout, so a handful of them exhausts the RPC pool and *reachable* nodes
start failing with `PoolTimeoutError`. `LEITHER_AND_MIMEI.md` §9.5 describes the
browser restriction; the fix belongs upstream of it — announcements served to a
public origin should be filtered to publicly routable addresses.

## P11 — Documentation

- Broken links on vzhan.cn (HTTP 500): `doc.html`, `capabilities.html`,
  `start.html`, `docs/MAPP_CONTAINER_ARCHITECTURE.md`, `app/example/main.go`,
  `app/example/README.md`. The last two are cited by `mapp-development.md` as the
  container-architecture and 8-entry references — exactly what P4/P5 need.
- `api/VarAct.md` gives `Act(...) error`; `lapi/stub.go` declares `(any, error)`.
- `troubleshooting.md` is required reading per `agent-skill-spec.md` but is not
  linked from `mapp-development.md`.

---

## Status on V0.24.02

P4 and P5 are now documented in `LEITHER_AND_MIMEI.md` §9.1/§9.2, which is a real
improvement. P4 remains a trap rather than a footnote, though: both official
examples (`hello`, `echo`) still dispatch on `switch Entry`, so both compile,
pass `--local`, and serve nothing once deployed.

P1, P2, P3, P6, P7, P8 are unchanged.

## Priority

1. **P1** — silent, hits ordinary Go code, breaks libraries.
2. **P2** — content never reaches the network; blocks production.
3. **P3/P4/P5** — cross-node calls, and two ways a correct app serves nothing.
4. **P6/P7** — stdlib and crypto.

P1, P4, P5, P6 have workarounds already applied here. **P2 and P3 have none.**
