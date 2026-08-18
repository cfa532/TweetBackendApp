# Leither Go MApp — issues

Found porting a 68-entry backend from JS to Go. All reproduced on a live node:
**V0.23.95**, linux/amd64. Probes are single files run with
`./Leither lpki runapp --local <dir> x -a gen8.key`.

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

## P6 — Standard library coverage is narrow and unintuitive

| Resolves | Missing |
|---|---|
| `fmt` `io` `errors` `strings` `strconv` `sort` `time` | `bytes` `unicode/utf8` `unicode/utf16` |
| `encoding/json` `math/big` `sync` `os` | `encoding/base64` `crypto/*` `regexp` `net/http` |

`bytes` and `unicode/utf8` are close to universal in Go. Note `encoding/json`
resolves while `unicode/utf8` does not, though json depends on it internally — so
the boundary isn't "what json needs". Cost here: hand-written JSON and base64
(~470 lines), and `json.go` spells out UTF-16 surrogate pairing.

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
like the extension point for exactly P2/P3/P7.

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

## P11 — Documentation

- Broken links on vzhan.cn (HTTP 500): `doc.html`, `capabilities.html`,
  `start.html`, `docs/MAPP_CONTAINER_ARCHITECTURE.md`, `app/example/main.go`,
  `app/example/README.md`. The last two are cited by `mapp-development.md` as the
  container-architecture and 8-entry references — exactly what P4/P5 need.
- `api/VarAct.md` gives `Act(...) error`; `lapi/stub.go` declares `(any, error)`.
- `troubleshooting.md` is required reading per `agent-skill-spec.md` but is not
  linked from `mapp-development.md`.

---

## Priority

1. **P1** — silent, hits ordinary Go code, breaks libraries.
2. **P2** — content never reaches the network; blocks production.
3. **P3/P4/P5** — cross-node calls, and two ways a correct app serves nothing.
4. **P6/P7** — stdlib and crypto.

P1, P4, P5, P6 have workarounds already applied here. **P2 and P3 have none.**
