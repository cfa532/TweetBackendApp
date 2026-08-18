// runtime.go — per-call context shared by every entry.
//
// A Leither MApp has a single exported function, RunMApp, that receives the
// entry name plus a flat map of string parameters. The JavaScript version had
// one file per entry, each closing over the globals `lapi`, `request` and
// `args`. The Go port keeps one function per entry and threads that state
// through a *ctx instead.
package lapp

import (
	"fmt"
	"io"

	"Leither/lapi"
)

// ctx carries everything an entry needs: the node API handle, the request
// parameters, and the response writer.
type ctx struct {
	api   lapi.LApi
	entry string
	req   map[string]string
	args  []any
	wr    io.Writer

	// nodeIDCache memoises GetVar("", "hostid"); entries ask for it repeatedly
	// while routing, and it cannot change during a call.
	nodeIDCache string
}

func newCtx(api lapi.LApi, entry string, req map[string]string, args []any, wr io.Writer) *ctx {
	if req == nil {
		req = map[string]string{}
	}
	return &ctx{api: api, entry: entry, req: req, args: args, wr: wr}
}

// ---------------------------------------------------------------------------
// Request parameters
// ---------------------------------------------------------------------------

// str returns a request parameter, or "" when absent.
func (c *ctx) str(key string) string { return c.req[key] }

// has reports whether a request parameter is present and non-empty.
func (c *ctx) has(key string) bool { return c.req[key] != "" }

// sid is the session id the node injects into every request.
func (c *ctx) sid() string { return c.req[lapi.Request_Sid] }

// appID is the application id ("aid"), assigned by Leither on publication.
func (c *ctx) appID() string { return c.req[lapi.Request_AppID] }

// ver is the application version the caller asked for; entries pass it on when
// calling another node.
func (c *ctx) ver() string { return c.req[lapi.Request_AppVer] }

// version is the client API version ("", "v2" or "v3"). It selects the response
// envelope, so clients on different releases keep working against one backend.
func (c *ctx) version() string { return c.req["version"] }

// obj decodes a request parameter that carries a JSON object.
func (c *ctx) obj(key string) (map[string]any, error) {
	raw := c.req[key]
	if raw == "" {
		return nil, fmt.Errorf("missing %s", key)
	}
	m, err := jsonParseObject(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid %s: %v", key, err)
	}
	return m, nil
}

// intParam reads a numeric request parameter, falling back to def.
func (c *ctx) intParam(key string, def int64) int64 {
	if raw := c.req[key]; raw != "" {
		if n, ok := toInt64(raw); ok {
			return n
		}
	}
	return def
}

// boolParam reads a boolean request parameter.
func (c *ctx) boolParam(key string) bool { return toBool(c.req[key]) }

// ---------------------------------------------------------------------------
// Node identity
// ---------------------------------------------------------------------------

// nodeID returns this node's host id. It is reported to clients and used by the
// few operations that must tell "this node" from the node another object lives
// on.
func (c *ctx) nodeID() string {
	if c.nodeIDCache != "" {
		return c.nodeIDCache
	}
	v, err := c.api.GetVar("", "hostid")
	if err != nil {
		c.errorf("get hostid failed: %v", err)
		return ""
	}
	c.nodeIDCache = toString(v)
	return c.nodeIDCache
}

// authSid logs in as the application author, which is the identity that owns
// application-created Mimei objects.
//
// An empty session is treated as failure. These calls report an unavailable
// identity by returning "" with a nil error, and an empty handle passed on to a
// database call fails much later as something unrecognisable — "invalid key
// size" from a Zadd, rather than "there is no author identity here".
func (c *ctx) authSid() (string, error) {
	sid, err := c.api.BELoginAsAuthor()
	if err != nil {
		return "", fmt.Errorf("BELoginAsAuthor failed: %v", err)
	}
	if sid == "" {
		return "", fmt.Errorf("BELoginAsAuthor returned no session: " +
			"the app has no author identity here (unpublished, or running --local)")
	}
	return sid, nil
}

// nodeDataSid opens the node's own application data area for writing. As with
// authSid, an empty handle is a failure rather than a usable value.
func (c *ctx) nodeDataSid(ver string) (string, error) {
	sid, err := c.api.BEOpenAppDataNode(ver, c.appID())
	if err != nil {
		return "", fmt.Errorf("BEOpenAppDataNode(%s) failed: %v", ver, err)
	}
	if sid == "" {
		return "", fmt.Errorf("BEOpenAppDataNode(%s) returned no session: "+
			"no application data area for aid=%s on this node", ver, c.appID())
	}
	return sid, nil
}

// ---------------------------------------------------------------------------
// Calling other entries
// ---------------------------------------------------------------------------

// callEntry runs another entry of this application on this node.
//
// The JavaScript implementation expressed this as RunMApp without an "nid",
// because each entry was a separate script. Here every entry is a function in
// one package, so the call is direct; going through the dispatch table keeps the
// entry names — which is how the original code named its dependencies — as the
// coupling between entries.
//
// params replaces the request rather than extending it, matching the explicit
// parameter maps the original calls built. aid and ver are inherited when the
// caller does not set them.
func (c *ctx) callEntry(entry string, params map[string]string) (any, error) {
	handler, ok := lookupEntry(entry)
	if !ok {
		return nil, fmt.Errorf("callEntry: unknown entry %s", entry)
	}
	if params == nil {
		params = map[string]string{}
	}
	if params[reqAppID] == "" {
		params[reqAppID] = c.appID()
	}
	if params[reqAppVer] == "" {
		params[reqAppVer] = verLast
	}
	if params[reqSid] == "" {
		params[reqSid] = c.sid()
	}

	sub := newCtx(c.api, entry, params, nil, c.wr)
	sub.nodeIDCache = c.nodeIDCache
	return handler(sub)
}

// callEntryMap runs another entry and decodes its reply as an object.
func (c *ctx) callEntryMap(entry string, params map[string]string) (map[string]any, error) {
	ret, err := c.callEntry(entry, params)
	if err != nil {
		return nil, err
	}
	m, _ := toMap(ret)
	return m, nil
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
//
// Log lines keep the "Tweed <entry>:" prefix the JavaScript version used, so
// existing node-side log greps continue to match.

func (c *ctx) logPrefix() string { return "Tweed " + c.entry + ": " }

func (c *ctx) tracef(format string, v ...any) { c.api.Trace(c.logPrefix()+format, v...) }
func (c *ctx) debugf(format string, v ...any) { c.api.Debug(c.logPrefix()+format, v...) }
func (c *ctx) infof(format string, v ...any)  { c.api.Info(c.logPrefix()+format, v...) }
func (c *ctx) warnf(format string, v ...any)  { c.api.Warn(c.logPrefix()+format, v...) }
func (c *ctx) errorf(format string, v ...any) { c.api.Error(c.logPrefix()+format, v...) }

// requestJSON renders the request map for error logs, matching the
// JSON.stringify(request) the JavaScript error handlers logged.
func (c *ctx) requestJSON() string {
	m := make(map[string]any, len(c.req))
	for k, v := range c.req {
		m[k] = v
	}
	return jsonStringify(m)
}
