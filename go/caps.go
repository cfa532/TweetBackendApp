// caps.go — node capabilities reached through the concrete API value.
//
// A MApp receives its API handle from lapi.GetLApi(), typed as the published
// lapi.LApi interface. That interface is narrower than the object behind it: at
// runtime the handle is a *frame.LApi, and the concrete type carries the
// replication and cross-node calls the original JavaScript app used through its
// own richer `lapi` global.
//
// The methods below are therefore reached by asserting the handle to a small
// interface declared here, one per operation. Nothing outside this file needs
// to know that, and the app keeps importing only the published "Leither/lapi".
//
// Why an assertion rather than importing the package that declares them:
//
//   - "Leither/api" does expose them, but it hands back the internal
//     *frame.LApi directly. Depending on a node's internal type would couple
//     this app to a surface its authors have not published, and offers nothing
//     the assertion does not.
//   - github.com/3and4/Leither/lapi does not declare them at any published
//     version (checked on main and on tags lapi/v0.1.0 and lapi/v0.1.1), so the
//     published interface cannot be used and `go build` cannot see them either.
//   - An assertion degrades: on a node build whose handle lacks a method, the
//     assertion fails and the caller gets capUnsupportedError instead of a
//     compile error or a panic. The signatures below were read off a live node
//     with fmt.Sprintf("%T", ...) and match the JavaScript call sites exactly.
//
// Confirmed present on Leither V0.24.02, with the JS call that matches:
//
//	MiMeiSync        lapi.MiMeiSync(sid, "", mid, {})     sync_user.js:51
//	MiMeiPublish     lapi.MiMeiPublish(sid, "", mid)      share_file.js:128
//	MiMeiProvide     lapi.MiMeiProvide(sid, "", mid)      get_tweet.js:106
//	MiMeiUnprovide   —
//	MiMeiUnpublish   —
//	MiMeiIsProvider  lapi.MiMeiIsProvider(sid, mid)       get_tweet.js:101
//	RunMApp          calling another node
//
// Still absent, with real consequences:
//
//	Ed25519Verify    agent signatures are not verified; see checkSignature in
//	                 auth.go. No in-app substitute exists either: crypto/* is
//	                 not in the interpreter's allowlist.
package lapp

import (
	"Leither/lapi"
	"errors"
	"fmt"
)

// ---------------------------------------------------------------------------
// Optional capabilities of the API handle
// ---------------------------------------------------------------------------

// Each interface names one method the concrete handle may carry beyond
// lapi.LApi. Signatures must match the node's exactly or the assertion fails
// silently and the capability reports itself unavailable.
//
// The second parameter of the MiMei calls selects which DHTs to act on; the
// JavaScript passes "" everywhere, meaning all of them, and so does this app.
type (
	mimeiSyncer interface {
		MiMeiSync(sid, dhts, mid string, param map[string]string) error
	}
	mimeiPublisher interface {
		MiMeiPublish(sid, dhts, mid string) ([]lapi.DhtReply, error)
	}
	mimeiProvider interface {
		MiMeiProvide(sid, dhts, mid string) ([]lapi.DhtReply, error)
	}
	mimeiUnprovider interface {
		MiMeiUnprovide(sid, dhts, mid string) ([]lapi.DhtReply, error)
	}
	mimeiUnpublisher interface {
		MiMeiUnpublish(sid, dhts, mid string) ([]lapi.DhtReply, error)
	}
	mimeiProviderCheck interface {
		MiMeiIsProvider(sid, mid string) (bool, error)
	}
	mappRunner interface {
		RunMApp(entry string, req map[string]string, args []any, opts ...string) (any, error)
	}
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
//	add_comment       -> add_tweet, creating a quote-comment's retweet half on
//	                     the node of the writer who owns it
//
// params must already contain aid/ver/sid and the entry's own arguments; nid is
// set here.
func (c *ctx) callRemote(nodeID, entry string, params map[string]string) (any, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("callRemote(%s): empty target node", entry)
	}
	params[reqNodeID] = nodeID
	runner, ok := c.api.(mappRunner)
	if !ok {
		return nil, capUnsupportedError{action: "RunMApp(nid=" + nodeID + ", entry=" + entry + ")"}
	}
	ret, err := runner.RunMApp(entry, params, nil, "nid="+nodeID)
	if err != nil {
		return nil, fmt.Errorf("RunMApp(nid=%s, entry=%s): %v", nodeID, entry, err)
	}
	return normalizeRemoteResult(ret), nil
}

// normalizeRemoteResult decodes a cross-node reply. A remote node returns the
// same envelope shape a local call would, but it may arrive as a JSON string
// depending on the transport.
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
//
// This is MiMeiSync(sid, "", mid, {}), the same call the JavaScript made.
// BEMMSync is not used as a substitute: it is the node's internal entry point,
// takes no session, and reaches the identical SyncMiMei, so falling back to it
// would buy nothing and would hide a node that stopped offering MiMeiSync.
func (c *ctx) mimeiSync(sid, mid string, param map[string]string) error {
	if mid == "" {
		return fmt.Errorf("mimeiSync: empty mid")
	}
	if param == nil {
		param = map[string]string{}
	}
	s, ok := c.api.(mimeiSyncer)
	if !ok {
		return capUnsupportedError{action: "MiMeiSync"}
	}
	if err := s.MiMeiSync(sid, "", mid, param); err != nil {
		return fmt.Errorf("MiMeiSync(%s): %v", mid, err)
	}
	return nil
}

// mimeiProvide announces that this node serves a copy of mid.
func (c *ctx) mimeiProvide(sid, mid string) error {
	p, ok := c.api.(mimeiProvider)
	if !ok {
		return capUnsupportedError{action: "MiMeiProvide"}
	}
	_, err := p.MiMeiProvide(sid, "", mid)
	return err
}

// mimeiPublish publishes mid to the DHT so other nodes can discover it.
func (c *ctx) mimeiPublish(sid, mid string) error {
	p, ok := c.api.(mimeiPublisher)
	if !ok {
		return capUnsupportedError{action: "MiMeiPublish"}
	}
	_, err := p.MiMeiPublish(sid, "", mid)
	return err
}

// mimeiUnprovide withdraws this node's claim to serve mid.
func (c *ctx) mimeiUnprovide(sid, mid string) error {
	p, ok := c.api.(mimeiUnprovider)
	if !ok {
		return capUnsupportedError{action: "MiMeiUnprovide"}
	}
	_, err := p.MiMeiUnprovide(sid, "", mid)
	return err
}

// mimeiUnpublish withdraws mid from the DHT.
func (c *ctx) mimeiUnpublish(sid, mid string) error {
	p, ok := c.api.(mimeiUnpublisher)
	if !ok {
		return capUnsupportedError{action: "MiMeiUnpublish"}
	}
	_, err := p.MiMeiUnpublish(sid, "", mid)
	return err
}

// mimeiIsProvider reports whether this node serves a copy of mid.
func (c *ctx) mimeiIsProvider(sid, mid string) (bool, error) {
	p, ok := c.api.(mimeiProviderCheck)
	if !ok {
		return false, capUnsupportedError{action: "MiMeiIsProvider"}
	}
	return p.MiMeiIsProvider(sid, mid)
}

// When to force a synchronisation, and when to let the provider table decide
//
// A node that already provides a mimei is kept current by the node's own
// replication, so pulling it again buys nothing. That makes MiMeiIsProvider —
// a local table lookup, no network — the right gate for anything whose purpose
// is possession rather than freshness. Only explicit user recovery still forces
// a sync:
//
//   - Feed, tweet-detail and profile pull-to-refresh reach
//     node_update_mid_by_score, sync_user or resync_user, and the user is
//     waiting on the newest data. Being a provider says the copy will catch up,
//     not that it already has. See the client policy in
//     docs/LEITHER_DATA_AND_SYNC_CONTRACT.md.
//   - Everything else takes or keeps a copy: following an account, saving a
//     tweet, quoting one, mimei_provide. Freshness is not the point, possession
//     is, and replication supplies the rest. These go through ensureProvided.
//
// Pulling an object back after a write would be a third case, since the copy
// here would be stale by exactly that write. It does not arise: clients address
// the account's root node directly (routing.go) and this app forwards no write.
//
// A site that has no copy at all (recoverUser, initialiseMid) needs no gate:
// this node cannot be providing what it does not hold.

// alreadyProviding reports whether this node already serves mid and so needs no
// copy pulled. A check that cannot be answered reports false, which leaves the
// caller doing the work it would have done anyway.
func (c *ctx) alreadyProviding(sid, mid string) bool {
	provided, err := c.mimeiIsProvider(sid, mid)
	if err != nil {
		c.warnf("provider check %s failed: %v", mid, err)
		return false
	}
	return provided
}

// syncIfRemote takes a copy of an object only when another node owns it.
//
// Synchronising a mimei this node already hosts cannot work — there is nowhere
// to pull from. The JavaScript entries made the call regardless and swallowed
// the error ("If original tweet is on the same node, MimeiSync will throw an
// error"); skipping it saves that round trip.
//
// ownerHost is the node that owns mid. An unknown owner is treated as remote,
// since attempting the sync is the recoverable choice.
func (c *ctx) syncIfRemote(sid, mid, ownerHost string) {
	if ownerHost != "" && ownerHost == c.nodeID() {
		c.debugf("skipping sync of %s: this node already hosts it", mid)
		return
	}
	c.ensureProvided(sid, mid)
}

// ensureProvided makes this node one of mid's providers, logging failures.
//
// Nothing is pulled when the node already provides the object, because
// replication keeps a provided copy current. Callers that need the newest data
// now — the recovery entries above — must call mimeiSync directly instead.
func (c *ctx) ensureProvided(sid, mid string) {
	if c.alreadyProviding(sid, mid) {
		c.debugf("skipping sync of %s: this node already provides it", mid)
		return
	}
	if err := c.mimeiSync(sid, mid, nil); err != nil {
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
// No node build seen so far carries this method under any spelling, so agent
// signatures remain unverified.
func (c *ctx) ed25519Verify(publicKey, message, signature string) (bool, error) {
	return false, capUnsupportedError{action: "Ed25519Verify"}
}
