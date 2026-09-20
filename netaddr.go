// netaddr.go — address parsing and filtering.
//
// Node and provider addresses arrive as "host:port" strings mixing IPv4 and
// bracketed IPv6. Clients need an address they can actually reach, so private
// and loopback ranges are filtered out: a node announcing 192.168.x.x is
// reachable only from its own LAN and would give a remote client a connection
// that hangs.
package lapp

import (
	"strconv"
	"strings"
)

// splitHostPort separates an address into host and port. IPv6 hosts may be
// bracketed, and the port is optional. A trailing ":something-non-numeric" is
// treated as part of the host, since a bare IPv6 address also ends that way.
//
// Limitation: an unbracketed IPv6 address whose last group is all digits, such
// as "fd00::1", is read as host "fd00:" plus port 1. Distinguishing that from a
// host:port pair is not possible without knowing the address family up front.
// It does not arise in practice — every announcement this app reads carries a
// port, and IPv6 is always bracketed when a port is present — and the previous
// JavaScript implementation parsed it the same way, so the filtering decisions
// downstream are unchanged.
func splitHostPort(addr string) (host string, port int) {
	if strings.HasPrefix(addr, "[") {
		if end := strings.Index(addr, "]"); end >= 0 {
			host = addr[1:end]
			rest := addr[end+1:]
			if strings.HasPrefix(rest, ":") {
				port, _ = strconv.Atoi(rest[1:])
			}
			return host, port
		}
	}
	if idx := strings.LastIndex(addr, ":"); idx >= 0 {
		if candidate := addr[idx+1:]; isAllDigits(candidate) {
			port, _ = strconv.Atoi(candidate)
			return addr[:idx], port
		}
	}
	return addr, 0
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// isIPv6 reports whether an address is IPv6. More than one colon distinguishes
// it from an IPv4 address that merely carries a port.
func isIPv6(addr string) bool {
	clean := addr
	if strings.HasPrefix(clean, "[") {
		if end := strings.Index(clean, "]"); end >= 0 {
			clean = clean[1:end]
		}
	}
	return strings.Count(clean, ":") > 1
}

// isPrivateIP reports whether an address is unreachable from outside its own
// network.
func isPrivateIP(addr string) bool {
	if strings.HasPrefix(addr, "[") {
		return isPrivateIPv6(addr)
	}
	// A bracketed IPv6 address reaches here without its brackets, so the colon
	// count is checked before any port is stripped.
	if strings.Count(addr, ":") > 1 {
		return isPrivateIPv6(addr)
	}
	host := addr
	if idx := strings.Index(host, ":"); idx >= 0 {
		host = host[:idx]
	}
	return isPrivateIPv4(host)
}

// isPrivateIPv4 covers the RFC 1918 ranges plus loopback and link-local.
func isPrivateIPv4(ip string) bool {
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return false
	}
	first, err1 := strconv.Atoi(parts[0])
	second, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return false
	}
	switch {
	case first == 10: // 10.0.0.0/8
		return true
	case first == 172 && second >= 16 && second <= 31: // 172.16.0.0/12
		return true
	case first == 192 && second == 168: // 192.168.0.0/16
		return true
	case first == 127: // loopback
		return true
	case first == 169 && second == 254: // link-local
		return true
	}
	// 26.26.26.0/24 is blocked as well: it belongs to a VPN range that has
	// shown up in announcements and is not routable here.
	if third, err := strconv.Atoi(parts[2]); err == nil {
		if first == 26 && second == 26 && third == 26 {
			return true
		}
	}
	return false
}

// isPrivateIPv6 covers loopback, unique-local and link-local addresses.
func isPrivateIPv6(ip string) bool {
	clean := ip
	if strings.HasPrefix(clean, "[") {
		if end := strings.Index(clean, "]"); end >= 0 {
			clean = clean[1:end]
		}
	}
	clean = strings.ToLower(clean)
	switch {
	case clean == "::1": // loopback
		return true
	case strings.HasPrefix(clean, "fc"), strings.HasPrefix(clean, "fd"): // fc00::/7
		return true
	case strings.HasPrefix(clean, "fe8"), strings.HasPrefix(clean, "fe9"),
		strings.HasPrefix(clean, "fea"), strings.HasPrefix(clean, "feb"): // fe80::/10
		return true
	case strings.HasPrefix(clean, "::ffff:127."): // IPv4-mapped loopback
		return true
	}
	return false
}

// usableAddress reports whether an announced address is worth handing to a
// client: public, and IPv4 when the caller can only use IPv4.
func usableAddress(addr string, v4Only bool) bool {
	host, _ := splitHostPort(addr)
	if isPrivateIP(host) {
		return false
	}
	if v4Only && isIPv6(host) {
		return false
	}
	return true
}
