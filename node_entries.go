// node_entries.go — provider control and node discovery.
//
// Keeping a non-root node's copy of an object current is Leither's job: a node
// that provides an object is brought up to date in the background. The only
// forced synchronisation is an explicit user refresh (resync_user,
// refresh_tweet, update_following_tweets), which calls mimeiSync directly.
package lapp

import (
	"fmt"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// mimei_provide
// ---------------------------------------------------------------------------

// entryMimeiProvide starts or stops serving an object from this node.
//
// Providing checks the existing role before registering it; Leither handles
// synchronization. Withdrawing also drops the stored versions, since nothing
// on this node refers to them any more.
func entryMimeiProvide(c *ctx) (any, error) {
	targetID := c.str(reqMID)
	provide := c.str("provide") == "true"

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}

	if provide {
		c.ensureProvided(authSid, targetID)
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

// entryGetNodeIP prefers a public address, using a ranked non-public address
// only when the node has no public route of the requested family.
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
	addresses = preferredNodeIPs(addresses, c.str("v4only") == "true")
	if len(addresses) > 0 {
		return c.wrapNotNull(addresses[0], "No valid node IPs found"), nil
	}
	return c.wrapNotNull(nil, "No valid node IPs found"), nil
}

// entryGetNodeIPs returns public addresses, or up to two other IPs when the
// node has no public route of the requested family.
func entryGetNodeIPs(c *ctx) (any, error) {
	addresses, err := c.nodeAddresses(c.str("nodeid"))
	if err != nil {
		return c.wrapErr(err), nil
	}
	valid := []any{}
	for _, addr := range preferredNodeIPs(addresses, c.str("v4only") == "true") {
		valid = append(valid, addr)
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
	for _, p := range preferredProviderAddresses(providers, v4Only) {
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
		c.failf(err)
		return respErr(err), nil
	}
	if providers == nil {
		return respOK([]any{}), nil
	}

	v4Only := c.str("v4only") == "true"
	valid := preferredProviderAddresses(providers, v4Only)
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
	node  int // Announcement group; retain identity until route selection.
}

// preferredNodeAddresses implements one policy for node, provider and file
// discovery: keep all public IPs, or the two lowest-score IPs if none are public.
// An IPv4-only caller makes that choice among IPv4 routes only.
func preferredNodeAddresses(addresses []providerAddr, v4Only bool) []providerAddr {
	public := []providerAddr{}
	fallback := []providerAddr{}
	for _, p := range addresses {
		if !validIPAddress(p.addr, v4Only) {
			continue
		}
		if usableAddress(p.addr, v4Only) {
			public = append(public, p)
		} else {
			fallback = append(fallback, p)
		}
	}
	if len(public) > 0 {
		return public
	}
	sort.SliceStable(fallback, func(i, j int) bool { return fallback[i].score < fallback[j].score })
	if len(fallback) > 2 {
		fallback = fallback[:2]
	}
	return fallback
}

func preferredNodeIPs(addresses []string, v4Only bool) []string {
	ranked := make([]providerAddr, 0, len(addresses))
	for i, addr := range addresses {
		ranked = append(ranked, providerAddr{addr: addr, score: int64(i)})
	}
	out := []string{}
	for _, p := range preferredNodeAddresses(ranked, v4Only) {
		out = append(out, p.addr)
	}
	return out
}

// Raw provider announcements are contiguous by node. Select routes per group
// before flattening so one public node cannot suppress a private-only node.
// Keep the raw parser separate: identityExists needs every announcement.
func preferredProviderAddresses(providers []providerAddr, v4Only bool) []providerAddr {
	out := []providerAddr{}
	for start := 0; start < len(providers); {
		end := start + 1
		for end < len(providers) && providers[end].node == providers[start].node {
			end++
		}
		out = append(out, preferredNodeAddresses(providers[start:end], v4Only)...)
		start = end
	}
	return out
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
	if decoded == nil {
		return nil, nil
	}
	groups, ok := toSlice(decoded)
	if !ok {
		return nil, fmt.Errorf("invalid provider groups for %s", mid)
	}

	out := []providerAddr{}
	for node, group := range groups {
		entries, ok := toSlice(group)
		if !ok {
			return nil, fmt.Errorf("invalid provider group for %s", mid)
		}
		for _, entry := range entries {
			pair, ok := toSlice(entry)
			if !ok || len(pair) < 2 {
				return nil, fmt.Errorf("invalid provider address for %s", mid)
			}
			addr := toString(pair[0])
			if addr == "" {
				return nil, fmt.Errorf("empty provider address for %s", mid)
			}
			score, _ := toInt64(pair[1])
			out = append(out, providerAddr{addr: addr, score: score, node: node})
		}
	}
	return out, nil
}

// wrapErrProvider reports a provider lookup failure; legacy callers read the
// result as a string and receive an empty one.
func (c *ctx) wrapErrProvider(err error) any {
	c.failf(err)
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
