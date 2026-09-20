package lapp

import (
	"fmt"
	"strings"
)

// entryPinIpfs retains an imported CID before the editor submits its tweet.
// Use a direct pin, matching `Leither ipfs pin add <cid>` without -r.
func entryPinIpfs(c *ctx) (any, error) {
	cid := strings.TrimSpace(c.str("cid"))
	// Accept a bare CID only; Leither validates the content identifier itself.
	if cid == "" || strings.ContainsAny(cid, "/\\?# \t\r\n") {
		return c.wrapErr(fmt.Errorf("A bare IPFS CID is required")), nil
	}
	if err := c.requireRootNode(c.str("userid")); err != nil {
		return c.wrapErr(err), nil
	}
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	pinner, ok := c.api.(ipfsPinner)
	if !ok {
		return c.wrapErr(capUnsupportedError{action: "IpfsPinAdd"}), nil
	}
	if err := pinner.IpfsPinAdd(authSid, false, "/ipfs/"+cid); err != nil {
		return c.wrapErr(fmt.Errorf("Could not pin CID %s: %v", cid, err)), nil
	}
	return c.wrap(map[string]any{"cid": cid, "pinned": true}), nil
}
