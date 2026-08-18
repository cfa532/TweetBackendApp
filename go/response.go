// response.go — response envelopes.
//
// Three client generations talk to this backend and the "version" request
// parameter selects which shape a reply takes:
//
//	""    legacy — the bare result; failure is signalled by a null result
//	"v2"  {"success": true, "data": ...} / {"success": false, "message": "..."}
//	"v3"  mostly the bare result, with richer payloads at a few entries
//
// The distinction that matters is that v3 is not simply "v2 with more fields".
// Most entries wrap only for v2 and hand a v3 client the bare value, because v3
// payloads carry their own structure. Failures are the exception: some entries
// report them in the envelope to v3 as well, since a bare null cannot tell a v3
// client whether the node lacked the data or the call never arrived.
//
// The JavaScript implementation repeated a wrapResponse/wrapError pair in every
// file with exactly these per-entry differences. They are named here and each
// entry keeps the behaviour its predecessor had, so no client sees a changed
// shape.
package lapp

// isV2 reports whether the caller asked for the v2 envelope.
func (c *ctx) isV2() bool { return c.version() == versionV2 }

// isV3 reports whether the caller asked for v3.
func (c *ctx) isV3() bool { return c.version() == versionV3 }

// ---------------------------------------------------------------------------
// Envelope builders
// ---------------------------------------------------------------------------

// respOK builds a success envelope.
func respOK(data any) map[string]any {
	return map[string]any{"success": true, "data": data}
}

// respFail builds a failure envelope carrying a message.
func respFail(message string) map[string]any {
	return map[string]any{"success": false, "message": message}
}

// respErr builds a failure envelope from an error.
func respErr(err error) map[string]any {
	if err == nil {
		return respFail("unknown error")
	}
	return respFail(err.Error())
}

// ---------------------------------------------------------------------------
// Version-conditional wrapping
// ---------------------------------------------------------------------------

// wrap applies the envelope for v2 callers and returns the bare result to
// everyone else.
func (c *ctx) wrap(result any) any {
	if c.isV2() {
		return respOK(result)
	}
	return result
}

// wrapNotNull is wrap for entries that report an absent result as a failure
// rather than as a successful null.
func (c *ctx) wrapNotNull(result any, notFound string) any {
	if c.isV2() {
		if result == nil {
			return respFail(notFound)
		}
		return respOK(result)
	}
	return result
}

// wrapErr logs and reports a failure to a v2 caller. Legacy callers received no
// value at all and detected failure by its absence, so nil is returned.
func (c *ctx) wrapErr(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() {
		return respErr(err)
	}
	return nil
}

// wrapErrV23 reports a failure to v2 and v3 callers alike. Used where a bare
// null would leave a v3 client unable to tell a missing object from a dead
// connection, and so unable to act on the result.
func (c *ctx) wrapErrV23(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() || c.isV3() {
		return respErr(err)
	}
	return nil
}

// wrapErrStatus reports a failure to v2 callers in the envelope and to legacy
// callers as the status/reason object they expect.
func (c *ctx) wrapErrStatus(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() {
		return respErr(err)
	}
	return map[string]any{"status": "failure", "reason": err.Error()}
}

// wrapErrAlways reports a failure in the envelope to every caller, for entries
// that never had a legacy error shape.
func (c *ctx) wrapErrAlways(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	return respErr(err)
}

// wrapStatus wraps a reply that already carries a "status" field, as the
// register and login replies do. A v2 caller gets a success flag derived from
// that status alongside the existing fields rather than nested under "data".
func (c *ctx) wrapStatus(result map[string]any) any {
	if !c.isV2() {
		return result
	}
	if _, ok := result["success"]; ok {
		return result
	}
	out := map[string]any{"success": mapStr(result, "status") == "success"}
	for k, v := range result {
		out[k] = v
	}
	return out
}

// wrapPassthrough wraps a reply that may already be an envelope, which is what
// a cross-node call returns. An existing envelope is passed
// through unchanged so a remote failure is not re-labelled as a local success.
func (c *ctx) wrapPassthrough(result any) any {
	if m, ok := toMap(result); ok {
		if _, isEnvelope := m["success"]; isEnvelope {
			return m
		}
	}
	return c.wrap(result)
}

// alwaysOK wraps unconditionally, for entries that returned the envelope to
// every caller regardless of version.
func (c *ctx) alwaysOK(result any, notFound string) any {
	if result == nil {
		return respFail(notFound)
	}
	return respOK(result)
}
