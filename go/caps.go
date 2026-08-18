// caps.go — node capabilities the Go MApp API does not expose directly.
//
// The JavaScript runtime handed scripts a `lapi` global that was richer than the
// Go `lapi.LApi` interface a MApp receives from GetLApi(). Seven operations the
// original app relied on have no method on that interface (verified by
// compiling against github.com/3and4/Leither/lapi):
//
//	RunMApp          calling another node    declared on ILApp, not on LApi
//	MiMeiSync        pull an object's data   see BEMMSync below
//	MiMeiProvide     announce local copy     absent
//	MiMeiPublish     publish to the DHT      absent
//	MiMeiUnprovide   withdraw announcement   absent
//	MiMeiUnpublish   withdraw from the DHT   absent
//	MiMeiIsProvider  provider check          absent
//	Ed25519Verify    signature check         absent
//
// Every use of those operations funnels through this file, so a node build that
// does expose them needs edits only here and nowhere in the entry code.
//
// What works:
//
//   - mimeiSync uses BEMMSync, which is on the interface and does the same job.
//
// What does NOT work, verified on Leither V0.23.95:
//
//   - Everything else. Act(sid, name, args...) looked like a generic escape
//     hatch, but it resolves *variables*, not actions: every name tried returns
//     "5020:Variable names unavailable". There is no in-app substitute either —
//     net/http and crypto/* are both absent from the interpreter, so these
//     cannot be reimplemented here.
//
// The consequences are real and mostly silent:
//
//   - Nothing this app writes is announced to the network. A new tweet, comment
//     or account is stored and readable on its own node, and invisible to every
//     other node. Writes still report success.
//   - The five operations that span two owners (see callRemote) fail outright.
//   - Agent signatures are not verified; see checkSignature in auth.go.
//
// These calls are kept, rather than deleted, so the shape of the application is
// preserved and a single edit here restores full behaviour once the node exposes
// them. Publishing and providing log and continue; cross-node calls surface the
// failure.
package lapp

import (
	"errors"
	"fmt"
	"strings"
)

// Action names attempted via Act. None currently resolves; they are retained so
// the intended mapping is documented if Act ever gains them.
const (
	actRunMApp         = "runmapp"
	actMiMeiProvide    = "mimeiprovide"
	actMiMeiPublish    = "mimeipublish"
	actMiMeiUnprovide  = "mimeiunprovide"
	actMiMeiUnpublish  = "mimeiunpublish"
	actMiMeiIsProvider = "mimeiisprovider"
	actEd25519Verify   = "ed25519verify"
)

// capUnsupportedError reports that this node build offers no route to a
// capability, letting callers tell "the node cannot do this" apart from "the
// operation ran and failed".
//
// It is a type rather than a sentinel value because the node's interpreter does
// not run package-level initialisers: a package-level error variable would be
// nil at runtime, and every comparison against it would quietly misclassify.
type capUnsupportedError struct{ action string }

func (e capUnsupportedError) Error() string {
	return e.action + ": capability not available on this node"
}

func isCapUnsupported(err error) bool {
	var target capUnsupportedError
	return errors.As(err, &target)
}

// act invokes a node action, translating a missing action into
// errCapUnsupported.
func (c *ctx) act(sid, name string, args ...string) (any, error) {
	ret, err := c.api.Act(sid, name, args...)
	if err != nil {
		if isUnknownAction(err) {
			return nil, capUnsupportedError{action: name}
		}
		return nil, fmt.Errorf("%s: %v", name, err)
	}
	return ret, nil
}

// isUnknownAction recognises the node's "no such action" rejection. The node
// reports it as an ordinary error, so the text is the only signal available.
//
// "variable names unavailable" is the one V0.23.95 actually returns: Act
// resolves variables, and every capability name here is absent from that
// namespace. Matching it is what lets callers degrade deliberately instead of
// treating a missing capability as a transient failure.
func isUnknownAction(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "variable names unavailable") ||
		strings.Contains(msg, "not found") ||
		strings.Contains(msg, "unknown") ||
		strings.Contains(msg, "unsupported") ||
		strings.Contains(msg, "no such")
}

// ---------------------------------------------------------------------------
// Calling another node
// ---------------------------------------------------------------------------

// callRemote runs an entry of this same application on another node.
//
// Clients choose which node to write to, so this is no longer used to redirect
// a misdirected request. What remains are the few operations that inherently
// span two owners on two nodes and cannot be split by the caller:
//
//	toggle_following  -> toggle_follower on the followed user's node
//	toggle_bookmark   -> toggle_bookmark_by_user on the acting user's node
//	toggle_favorite   -> toggle_favorite_by_user on the acting user's node
//	set_author_core_data -> sync_user, warming the node an account is moving to
//	node_update_mid_by_score -> node_get_score, comparing against the owner
//	toggle_following  -> get_tweet_id_list, reading the followed user's tweets
//
// params must already contain aid/ver/sid and the entry's own arguments; nid is
// set here.
func (c *ctx) callRemote(nodeID, entry string, params map[string]string) (any, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("callRemote(%s): empty target node", entry)
	}
	params[reqNodeID] = nodeID

	// Act carries strings only, so the parameter map travels as JSON.
	payload := make(map[string]any, len(params))
	for k, v := range params {
		payload[k] = v
	}
	ret, err := c.act(c.sid(), actRunMApp, entry, jsonStringify(payload))
	if err != nil {
		return nil, err
	}
	return normalizeRemoteResult(ret), nil
}

// normalizeRemoteResult decodes a cross-node reply. A remote node returns
// the same envelope shape a local call would, but it may arrive as a JSON
// string depending on the transport.
func normalizeRemoteResult(ret any) any {
	if s, ok := ret.(string); ok {
		if looksLikeJSONObject(s) || looksLikeJSONArray(s) {
			if v, err := jsonParse(s); err == nil {
				return v
			}
		}
	}
	return ret
}

// ---------------------------------------------------------------------------
// Mimei replication
// ---------------------------------------------------------------------------

// mimeiSync pulls an object's current data from the network onto this node.
// BEMMSync is the interface method for this and is used directly.
func (c *ctx) mimeiSync(mid string, param map[string]string) error {
	if mid == "" {
		return fmt.Errorf("mimeiSync: empty mid")
	}
	if param == nil {
		param = map[string]string{}
	}
	if err := c.api.BEMMSync("", mid, param); err != nil {
		return fmt.Errorf("BEMMSync(%s): %v", mid, err)
	}
	return nil
}

// mimeiProvide announces that this node serves a copy of mid.
func (c *ctx) mimeiProvide(sid, mid string) error {
	_, err := c.act(sid, actMiMeiProvide, "", mid)
	return err
}

// mimeiPublish publishes mid to the DHT so other nodes can discover it.
func (c *ctx) mimeiPublish(sid, mid string) error {
	_, err := c.act(sid, actMiMeiPublish, "", mid)
	return err
}

// mimeiUnprovide withdraws this node's claim to serve mid.
func (c *ctx) mimeiUnprovide(sid, mid string) error {
	_, err := c.act(sid, actMiMeiUnprovide, "", mid)
	return err
}

// mimeiUnpublish withdraws mid from the DHT.
func (c *ctx) mimeiUnpublish(sid, mid string) error {
	_, err := c.act(sid, actMiMeiUnpublish, "", mid)
	return err
}

// mimeiIsProvider reports whether this node serves a copy of mid.
func (c *ctx) mimeiIsProvider(sid, mid string) (bool, error) {
	ret, err := c.act(sid, actMiMeiIsProvider, mid)
	if err != nil {
		return false, err
	}
	return toBool(ret), nil
}

// syncBestEffort pulls an object and announces the local copy, logging failures.
func (c *ctx) syncBestEffort(sid, mid string) {
	if err := c.mimeiSync(mid, nil); err != nil {
		c.warnf("sync %s failed: %v", mid, err)
		return
	}
	if err := c.mimeiProvide(sid, mid); err != nil {
		c.warnf("provide %s failed: %v", mid, err)
	}
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

// ed25519Verify checks a detached signature over msg with the given public key.
// It backs agent-token authentication.
//
// All three arguments are base64url strings, matching what the clients send.
func (c *ctx) ed25519Verify(publicKey, message, signature string) (bool, error) {
	ret, err := c.act(c.sid(), actEd25519Verify, publicKey, message, signature)
	if err != nil {
		return false, err
	}
	return toBool(ret), nil
}
