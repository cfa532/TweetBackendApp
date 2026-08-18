// auth.go — request authorisation.
//
// Two mechanisms let a write proceed:
//
//   - Node app code. A peer node presents a code that resolves, through the
//     node's session store, to the calling node id and the application it was
//     issued for. A request with no code came from the front end rather than a
//     peer and is attributed to the user's own host.
//
//   - Agent authentication. An AI agent acting for a user signs a canonical
//     rendering of the request with the user's Ed25519 agent key. This lets an
//     agent post without holding the user's password.
package lapp

import (
	"fmt"
	"time"
)

// maxRequestAge bounds how old a signed agent request may be, limiting the
// window in which a captured signature can be replayed.
const maxRequestAge = 5 * time.Minute

// maxClockSkew is how far into the future a signed request may be dated before
// it is rejected, allowing for unsynchronised clocks.
const maxClockSkew = time.Minute

// ed25519SignatureLen is the byte length of an Ed25519 signature.
const ed25519SignatureLen = 64

// nowMillis is the current time in milliseconds since the epoch, the unit every
// timestamp in this application uses.
func nowMillis() int64 { return time.Now().UnixMilli() }

// ---------------------------------------------------------------------------
// Agent authentication
// ---------------------------------------------------------------------------

// agentAuthResult reports the outcome of verifying an agent request. It mirrors
// the {valid, error, mimeiId} object the JavaScript version returned, which the
// clients already parse.
type agentAuthResult struct {
	valid   bool
	reason  string
	mimeiID string
}

func (r agentAuthResult) toMap() map[string]any {
	out := map[string]any{"valid": r.valid}
	if r.reason != "" {
		out["error"] = r.reason
	}
	if r.mimeiID != "" {
		out["mimeiId"] = r.mimeiID
	}
	return out
}

func agentAuthInvalid(reason string) agentAuthResult {
	return agentAuthResult{valid: false, reason: reason}
}

// parseAgentAuth decodes the agentAuth request parameter. It may arrive as a
// JSON string rather than a nested object because the transport between nodes
// cannot carry nested maps.
func parseAgentAuth(raw string) (map[string]any, error) {
	if raw == "" {
		return nil, nil
	}
	auth, err := jsonParseObject(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid agentAuth: %v", err)
	}
	return auth, nil
}

// verifyAgentAuth checks an agent's signature over requestData.
//
// The signed message is requestData plus the mimeiId and timestamp from the
// auth block, serialised as JSON with keys sorted at every level. The client
// builds the same string before signing, so any disagreement about field order
// or number formatting shows up as an invalid signature.
func (c *ctx) verifyAgentAuth(auth map[string]any, requestData map[string]any) agentAuthResult {
	mimeiID := mapStr(auth, "mimeiId")
	signature := mapStr(auth, "signature")
	timestamp := mapInt(auth, "timestamp", 0)
	if mimeiID == "" || signature == "" || timestamp == 0 {
		return agentAuthInvalid("Missing required agentAuth fields")
	}

	age := time.Duration(nowMillis()-timestamp) * time.Millisecond
	if age > maxRequestAge {
		c.warnf("Request expired, age=%dms, max=%dms", age.Milliseconds(), maxRequestAge.Milliseconds())
		return agentAuthInvalid("Request expired")
	}
	if age < -maxClockSkew {
		c.warnf("Request timestamp in future, age=%dms", age.Milliseconds())
		return agentAuthInvalid("Invalid timestamp")
	}

	user, err := c.loadUser(mimeiID)
	if err != nil {
		c.errorf("Failed to get user data for %s: %v", mimeiID, err)
		return agentAuthInvalid("User not found")
	}
	publicKey := user.agentPublicKey()
	if publicKey == "" {
		c.warnf("No agent public key configured for user %s", mimeiID)
		return agentAuthInvalid("Agent not configured for this user")
	}

	signed := map[string]any{}
	for k, v := range requestData {
		signed[k] = v
	}
	signed["mimeiId"] = mimeiID
	signed["timestamp"] = timestamp
	// jsonStringify sorts keys at every level, which is the canonical form the
	// client signs.
	message := jsonStringify(signed)

	valid, err := c.checkSignature(publicKey, message, signature)
	if err != nil {
		c.errorf("Agent verification error: %v", err)
		return agentAuthInvalid("Verification failed: " + err.Error())
	}
	if !valid {
		c.warnf("Invalid signature for user %s, app=%s", mimeiID, c.appID())
		return agentAuthInvalid("Invalid signature")
	}
	c.debugf("Valid signature for user %s, app=%s", mimeiID, c.appID())
	return agentAuthResult{valid: true, mimeiID: mimeiID}
}

// checkSignature verifies a detached Ed25519 signature.
//
// When the node offers no verification routine the check degrades to
// confirming the signature is well formed — 64 decodable bytes. That is the
// same degradation the JavaScript implementation applied when lapi.Ed25519Verify
// was absent, and it is deliberately weak: it establishes that a signature was
// supplied, not that it is the right one. See caps.go for how to restore full
// verification.
func (c *ctx) checkSignature(publicKey, message, signature string) (bool, error) {
	valid, err := c.ed25519Verify(publicKey, message, signature)
	if err == nil {
		return valid, nil
	}
	if !isCapUnsupported(err) {
		return false, err
	}

	sig, decodeErr := base64Decode(signature)
	if decodeErr != nil {
		return false, fmt.Errorf("invalid signature encoding: %v", decodeErr)
	}
	if len(sig) != ed25519SignatureLen {
		return false, fmt.Errorf("invalid signature format (expected %d bytes, got %d)",
			ed25519SignatureLen, len(sig))
	}
	c.infof("Ed25519Verify not available, using lightweight agent auth check")
	return true, nil
}

// ---------------------------------------------------------------------------
// Node app code
// ---------------------------------------------------------------------------

// friendByAppCode resolves the node behind a node app code.
//
// An empty code means the caller is the front end rather than a peer node, in
// which case the user's own host is used. A non-empty code must have been
// issued for this application; a code for another application is rejected.
func (c *ctx) friendByAppCode(nodeAppCode, frontEndHostID string) (string, error) {
	if nodeAppCode == "" {
		return frontEndHostID, nil
	}
	c.tracef("nodeAppCode=%s", nodeAppCode)

	nodeID, err := c.api.SessionGet(nodeAppCode, "nodeid")
	if err != nil {
		return "", fmt.Errorf("SessionGet(nodeid): %v", err)
	}
	forApp, err := c.api.SessionGet(nodeAppCode, "forapp")
	if err != nil {
		return "", fmt.Errorf("SessionGet(forapp): %v", err)
	}
	c.tracef("forapp=%s appid=%s", toString(forApp), c.appID())

	if got := toString(forApp); got != c.appID() {
		return "", fmt.Errorf("App ID mismatch: expected %s, got %s", c.appID(), got)
	}
	return toString(nodeID), nil
}
