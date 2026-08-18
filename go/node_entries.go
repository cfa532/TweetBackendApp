// node_entries.go — node discovery and cross-node change tracking.
//
// # Scores
//
// Each node keeps a sorted set per user in its own application data, holding one
// score per object that user owns. The score is a sequence number that advances
// whenever the object changes. Comparing this node's score for an object against
// the score held by the object's home node is how a node decides whether its
// copy is stale, without transferring the object to find out.
//
//	node_update_score        bump an object's score after changing it
//	node_get_score           read an object's score, assigning one if new
//	node_update_mid_by_score compare against the home node and pull if behind
package lapp

import (
	"fmt"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

// entryNodeUpdateScore records that an object changed.
//
// Every entry that writes an object calls this afterwards. On the object's home
// node the new score means "this changed"; elsewhere it records the score this
// node has caught up to.
func entryNodeUpdateScore(c *ctx) (any, error) {
	userID := c.str("userid")
	mid := c.str(reqMID)

	mmsid, err := c.nodeDataSid(verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.zaddSeq(mmsid, userID, mid); err != nil {
		return c.wrapErr(err), nil
	}
	return c.wrap(map[string]any{"success": true}), nil
}

// entryNodeGetScore reads an object's score, assigning one if the object has
// not been seen before so that the caller always receives a comparable value.
func entryNodeGetScore(c *ctx) (any, error) {
	userID := c.str("userid")
	mid := c.str(reqMID)

	mmsid, err := c.nodeDataSid(verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	rank, err := c.zrank(mmsid, userID, mid)
	if err != nil {
		return c.wrapErr(err), nil
	}
	if rank == -1 {
		if err := c.zaddSeq(mmsid, userID, mid); err != nil {
			return c.wrapErr(err), nil
		}
	}
	score, err := c.zscore(mmsid, userID, mid)
	if err != nil {
		return c.wrapErr(err), nil
	}
	return c.wrapNotNull(score, "Score not found"), nil
}

// entryNodeUpdateMidByScore pulls an object from its home node if this node's
// copy is behind.
//
// This is the cheap staleness check: only the score crosses the network unless
// the copies actually differ.
func entryNodeUpdateMidByScore(c *ctx) (any, error) {
	hostID := c.str("hostid")
	userID := c.str("userid")
	mid := c.str(reqMID)

	// On the object's own node there is nothing to compare against.
	if c.nodeID() == hostID {
		return c.wrap(map[string]any{"success": true, "message": "Already on target host"}), nil
	}

	systemSid, err := c.nodeDataSid(verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}

	rank, err := c.zrank(systemSid, userID, mid)
	if err != nil {
		return c.wrapErr(err), nil
	}
	if rank == -1 {
		// Never seen here: take a copy rather than comparing scores.
		if err := c.initialiseMid(systemSid, userID, mid); err != nil {
			c.errorf("Failed to add new mid %s: %v", mid, err)
			return c.wrapErr(fmt.Errorf("Failed to initialize new mid: %v", err)), nil
		}
		return c.wrap(map[string]any{"success": true}), nil
	}

	remoteScore, err := c.callRemote(hostID, "node_get_score", map[string]string{
		reqAppID:   c.appID(),
		reqAppVer:  c.ver(),
		reqSid:     systemSid,
		reqVersion: c.version(),
		"userid":   userID,
		reqMID:     mid,
	})
	if err != nil {
		return c.wrapErr(err), nil
	}
	localScore, err := c.zscore(systemSid, userID, mid)
	if err != nil {
		return c.wrapErr(err), nil
	}

	remote, ok := toInt64(remoteScore)
	if !ok {
		return c.wrapErr(fmt.Errorf("Invalid remote score for mid %s: %s", mid, jsonStringify(remoteScore))), nil
	}
	if remote != localScore {
		c.debugf("mid=%s, new score=%d, old score=%d, userId=%s", mid, remote, localScore, userID)
		if err := c.mimeiSync(mid, nil); err != nil {
			return c.wrapErr(err), nil
		}
		// The home node's score is adopted verbatim, so this node records how
		// far it has caught up rather than inventing a sequence of its own.
		if err := c.zadd(systemSid, userID, remote, mid); err != nil {
			return c.wrapErr(err), nil
		}
	}
	return c.wrap(map[string]any{"success": true}), nil
}

// initialiseMid records and fetches an object this node has not held before.
func (c *ctx) initialiseMid(systemSid, userID, mid string) error {
	if err := c.zaddSeq(systemSid, userID, mid); err != nil {
		return err
	}
	if err := c.mimeiSync(mid, nil); err != nil {
		return err
	}
	return c.mimeiProvide(systemSid, mid)
}

// ---------------------------------------------------------------------------
// mimei_provide
// ---------------------------------------------------------------------------

// entryMimeiProvide starts or stops serving an object from this node.
//
// Providing pulls a current copy first, so the node does not advertise content
// it cannot serve. Withdrawing also drops the stored versions, since nothing on
// this node refers to them any more.
func entryMimeiProvide(c *ctx) (any, error) {
	targetID := c.str(reqMID)
	provide := c.str("provide") == "true"

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}

	if provide {
		if err := c.mimeiSync(targetID, nil); err != nil {
			return c.wrapErr(err), nil
		}
		if err := c.mimeiProvide(authSid, targetID); err != nil {
			c.errorf("Failed to provide %s: %v", targetID, err)
		} else {
			c.debugf("provide targetId=%s", targetID)
		}
	} else {
		if err := c.mimeiUnprovide(authSid, targetID); err != nil {
			c.errorf("Failed to unprovide %s: %v", targetID, err)
		} else {
			c.debugf("Unprovide targetId=%s", targetID)
		}
		if err := c.delVersions(authSid, targetID); err != nil {
			c.errorf("Failed to delete versions %s: %v", targetID, err)
		}
	}
	return c.wrap(map[string]any{"success": true}), nil
}

// ---------------------------------------------------------------------------
// Node addresses
// ---------------------------------------------------------------------------

// entryGetNodeIP returns one reachable address for a node, or nothing when the
// node only announces private addresses.
func entryGetNodeIP(c *ctx) (any, error) {
	addresses, err := c.nodeAddresses(c.str("nodeid"))
	if err != nil {
		return c.wrapErr(err), nil
	}
	if addresses == nil {
		// No announcement at all is reported as an absent value rather than an
		// empty result, matching what callers expect from an unknown node.
		return nil, nil
	}
	v4Only := c.str("v4only") == "true"
	for _, addr := range addresses {
		if usableAddress(addr, v4Only) {
			return c.wrapNotNull(addr, "No valid node IPs found"), nil
		}
	}
	return c.wrapNotNull(nil, "No valid node IPs found"), nil
}

// entryGetNodeIPs returns every reachable address for a node, so a client can
// try them in order.
func entryGetNodeIPs(c *ctx) (any, error) {
	addresses, err := c.nodeAddresses(c.str("nodeid"))
	if err != nil {
		return c.wrapErr(err), nil
	}
	v4Only := c.str("v4only") == "true"
	valid := []any{}
	for _, addr := range addresses {
		if usableAddress(addr, v4Only) {
			valid = append(valid, addr)
		}
	}
	if len(valid) == 0 {
		return c.wrapNotNull(nil, "No valid node IPs found"), nil
	}
	return c.wrapNotNull(valid, "No valid node IPs found"), nil
}

// nodeAddresses reads a node's announced addresses. A node with no
// announcement yields a nil slice, which the callers distinguish from an
// announcement containing nothing usable.
func (c *ctx) nodeAddresses(nodeID string) ([]string, error) {
	raw, err := c.api.GetVar("", "ips", nodeID)
	if err != nil {
		return nil, fmt.Errorf("GetVar(ips, %s): %v", nodeID, err)
	}
	text := toString(raw)
	if text == "" {
		return nil, nil
	}
	out := []string{}
	for _, part := range splitAndTrim(text, ",") {
		if part != "" {
			out = append(out, part)
		}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Provider addresses
// ---------------------------------------------------------------------------

// entryGetProviderIP returns the address of the provider that answered fastest,
// which is how a client picks where to fetch an object it does not hold.
func entryGetProviderIP(c *ctx) (any, error) {
	providers, err := c.providerAddresses(c.str(reqMID))
	if err != nil {
		return c.wrapErrProvider(err), nil
	}
	if providers == nil {
		// Malformed or absent provider data is reported as no value at all,
		// which is what callers treat as "nobody serves this".
		return nil, nil
	}

	v4Only := c.str("v4only") == "true"
	best := ""
	var bestScore int64
	found := false
	for _, p := range providers {
		if !usableAddress(p.addr, v4Only) {
			continue
		}
		if !found || p.score < bestScore {
			best, bestScore, found = p.addr, p.score, true
		}
	}
	if best == "" {
		return c.wrapNotNull(nil, "Provider IP not found"), nil
	}
	return c.wrapNotNull(best, "Provider IP not found"), nil
}

// entryGetProviderIPs returns every reachable provider, fastest first.
//
// This entry answers only in the v2 envelope; it was added after the legacy
// shape was retired.
func entryGetProviderIPs(c *ctx) (any, error) {
	providers, err := c.providerAddresses(c.str(reqMID))
	if err != nil {
		c.errorf("%v, request=%s", err, c.requestJSON())
		return respErr(err), nil
	}
	if providers == nil {
		return respOK([]any{}), nil
	}

	v4Only := c.str("v4only") == "true"
	valid := make([]providerAddr, 0, len(providers))
	for _, p := range providers {
		if usableAddress(p.addr, v4Only) {
			valid = append(valid, p)
		}
	}
	sort.SliceStable(valid, func(i, j int) bool { return valid[i].score < valid[j].score })

	out := make([]any, 0, len(valid))
	for _, p := range valid {
		out = append(out, p.addr)
	}
	return respOK(out), nil
}

// providerAddr is one announced provider and its response score, where a lower
// score means a faster answer.
type providerAddr struct {
	addr  string
	score int64
}

// providerAddresses reads the providers announced for an object.
//
// The node reports them as JSON of the form [[[ "ip:port", score ], ...]] — a
// list of announcements, each a list of address/score pairs — and the value is
// sometimes doubly encoded, so a decoded string is decoded once more.
func (c *ctx) providerAddresses(mid string) ([]providerAddr, error) {
	raw, err := c.api.GetVar("", "mmprovsips", mid)
	if err != nil {
		return nil, fmt.Errorf("GetVar(mmprovsips, %s): %v", mid, err)
	}
	text := toString(raw)
	if text == "" {
		return nil, nil
	}
	decoded, err := jsonParse(text)
	if err != nil {
		return nil, fmt.Errorf("invalid provider data: %v", err)
	}
	if inner, ok := decoded.(string); ok {
		decoded, err = jsonParse(inner)
		if err != nil {
			return nil, fmt.Errorf("invalid provider data: %v", err)
		}
	}
	groups, ok := toSlice(decoded)
	if !ok {
		return nil, nil
	}

	out := []providerAddr{}
	for _, group := range groups {
		entries, ok := toSlice(group)
		if !ok {
			continue
		}
		for _, entry := range entries {
			pair, ok := toSlice(entry)
			if !ok || len(pair) < 2 {
				continue
			}
			addr := toString(pair[0])
			if addr == "" {
				continue
			}
			score, _ := toInt64(pair[1])
			out = append(out, providerAddr{addr: addr, score: score})
		}
	}
	return out, nil
}

// wrapErrProvider reports a provider lookup failure; legacy callers read the
// result as a string and receive an empty one.
func (c *ctx) wrapErrProvider(err error) any {
	c.errorf("%v, request=%s", err, c.requestJSON())
	if c.isV2() {
		return respErr(err)
	}
	return ""
}

// splitAndTrim splits a delimited string and trims each field.
func splitAndTrim(s, sep string) []string {
	parts := strings.Split(s, sep)
	for i, p := range parts {
		parts[i] = strings.TrimSpace(p)
	}
	return parts
}
