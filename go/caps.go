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
// What does NOT, re-verified on Leither V0.24.02 by compiling calls against the
// node's own interpreter-registered lapi:
//
//   - All seven remain absent. Act(sid, name, args...) is not a route to them:
//     it resolves nothing at all, failing even for "ver", a name GetVar answers.
//     api/VarAct.md marks Act a draft holding 待定 (pending) APIs, so an empty
//     registry is intended. There is no in-app substitute either — net/http and
//     crypto/* are absent from the interpreter allowlist.
//
// Each function below therefore fails immediately and names the lapi method it
// wants, rather than attempting a call that cannot succeed. Attempting Act first
// only cost a round trip per write and logged "5020:Variable names unavailable",
// which reads like a misconfiguration rather than a missing API. The line above
// each return shows the single edit that restores the capability.
//
// The consequences are real and mostly silent:
//
//   - Nothing this app writes is announced to the network. A new tweet, comment
//     or account is stored and readable on its own node, and invisible to every
//     other node. Writes still report success, which matches the guidance in
//     LEITHER_AND_MIMEI.md §7: commit success and publication success are
//     separate facts and must be tracked separately.
//   - The operations that span two owners (see callRemote) fail outright.
//   - Agent signatures are not verified; see checkSignature in auth.go.
package lapp

import (
	"errors"
	"fmt"
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
	// When lapi exposes it:
	//   return normalizeRemoteResult(c.api.RunMApp(entry, params, nil, "nid="+nodeID))
	return nil, capUnsupportedError{action: "RunMApp(nid=" + nodeID + ", entry=" + entry + ")"}
}

// normalizeRemoteResult decodes a cross-node reply. A remote node returns the
// same envelope shape a local call would, but it may arrive as a JSON string
// depending on the transport.
//
// Currently unreferenced except by the restoration line in callRemote: it is
// kept because it is needed the moment RunMApp becomes callable, and writing it
// again from scratch is where a transport-shape bug would creep in.
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
	// When lapi exposes it: _, err := c.api.MiMeiProvide(sid, "", mid); return err
	return capUnsupportedError{action: "MiMeiProvide"}
}

// mimeiPublish publishes mid to the DHT so other nodes can discover it.
func (c *ctx) mimeiPublish(sid, mid string) error {
	// When lapi exposes it: _, err := c.api.MiMeiPublish(sid, "", mid); return err
	return capUnsupportedError{action: "MiMeiPublish"}
}

// mimeiUnprovide withdraws this node's claim to serve mid.
func (c *ctx) mimeiUnprovide(sid, mid string) error {
	// When lapi exposes it: _, err := c.api.MiMeiUnprovide(sid, "", mid); return err
	return capUnsupportedError{action: "MiMeiUnprovide"}
}

// mimeiUnpublish withdraws mid from the DHT.
func (c *ctx) mimeiUnpublish(sid, mid string) error {
	// When lapi exposes it: _, err := c.api.MiMeiUnpublish(sid, "", mid); return err
	return capUnsupportedError{action: "MiMeiUnpublish"}
}

// mimeiIsProvider reports whether this node serves a copy of mid.
func (c *ctx) mimeiIsProvider(sid, mid string) (bool, error) {
	// When lapi exposes it: return c.api.MiMeiIsProvider(sid, mid)
	return false, capUnsupportedError{action: "MiMeiIsProvider"}
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
	// When lapi exposes it:
	//   return c.api.Ed25519Verify(publicKey, message, signature)
	return false, capUnsupportedError{action: "Ed25519Verify"}
}
