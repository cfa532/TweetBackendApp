// misc_entries.go — health and diagnostics.
package lapp

// entryHealth reports that the node is serving this application. Clients call
// it to decide whether a node is reachable before sending real work.
func entryHealth(c *ctx) (any, error) {
	return map[string]any{
		"success": true,
		"message": "Server is running",
	}, nil
}

// entryLogging records a client-supplied message in the node log, so a client
// can attach its own context to a server-side investigation.
func entryLogging(c *ctx) (any, error) {
	c.debugf("%s", c.str("msg"))
	return c.wrap(map[string]any{
		"success": true,
		"message": "Logged successfully",
	}), nil
}
