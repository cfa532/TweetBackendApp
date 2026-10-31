// netaddr.go — address parsing and filtering.
//
// Node and provider addresses arrive as "host:port" strings mixing IPv4 and
// bracketed IPv6. Clients need an address they can actually reach, so private
// and loopback ranges, plus Tailscale's shared IPv4 range, are filtered out:
// a node announcing 192.168.x.x is reachable only from its own LAN and would
// give a remote client a connection that hangs.
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

// ipv4Octets accepts only IPv4 literals, never hostnames or malformed values.
func ipv4Octets(ip string) ([]int, bool) {
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return nil, false
	}
	out := make([]int, 4)
	for i, part := range parts {
		if !isAllDigits(part) {
			return nil, false
		}
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 || n > 255 {
			return nil, false
		}
		out[i] = n
	}
	return out, true
}

// isBenchmarkIPv4 recognizes the benchmarking range also used by VPN TUN
// interfaces. It is not a usable public route, including for shared files.
func isBenchmarkIPv4(ip string) bool {
	parts, ok := ipv4Octets(ip)
	return ok && parts[0] == 198 && (parts[1] == 18 || parts[1] == 19)
}

// isPrivateIPv4 excludes non-public literals and known VPN subnets. Keep this
// policy aligned with TweetWeb's publicIPv4BaseUrl.
func isPrivateIPv4(ip string) bool {
	parts, ok := ipv4Octets(ip)
	if !ok {
		return true
	}
	first, second, third := parts[0], parts[1], parts[2]
	return first == 0 || first == 10 || first == 127 || first >= 224 ||
		(first == 26 && second == 26 && third == 26) || // Known VPN TUN subnet
		(first == 100 && second >= 64 && second <= 127) || // CGNAT / Tailscale
		(first == 169 && second == 254) ||
		(first == 172 && second >= 16 && second <= 31) ||
		(first == 192 && second == 168) ||
		(first == 192 && second == 0 && (third == 0 || third == 2)) ||
		(first == 192 && second == 88 && third == 99) ||
		isBenchmarkIPv4(ip) ||
		(first == 198 && second == 51 && third == 100) ||
		(first == 203 && second == 0 && third == 113)
}

// ipv6Words expands a literal without importing packages unavailable in the
// Leither interpreter. Expansion makes compressed and full subnet spellings
// receive the same classification.
func ipv6Words(ip string) ([]int, bool) {
	if strings.Contains(ip, ".") {
		last := strings.LastIndex(ip, ":")
		if last < 0 {
			return nil, false
		}
		v4, ok := ipv4Octets(ip[last+1:])
		if !ok {
			return nil, false
		}
		ip = ip[:last+1] + strconv.FormatInt(int64(v4[0]*256+v4[1]), 16) + ":" +
			strconv.FormatInt(int64(v4[2]*256+v4[3]), 16)
	}
	halves := strings.Split(ip, "::")
	if len(halves) > 2 {
		return nil, false
	}
	words := make([]int, 0, 8)
	for side, half := range halves {
		if half != "" {
			for _, part := range strings.Split(half, ":") {
				if len(part) == 0 || len(part) > 4 || strings.Trim(part, "0123456789abcdefABCDEF") != "" {
					return nil, false
				}
				n, err := strconv.ParseUint(part, 16, 16)
				if err != nil {
					return nil, false
				}
				words = append(words, int(n))
			}
		}
		if side == 0 && len(halves) == 2 {
			rightCount := 0
			if halves[1] != "" {
				rightCount = len(strings.Split(halves[1], ":"))
			}
			zeros := 8 - len(words) - rightCount
			if zeros < 1 {
				return nil, false
			}
			for i := 0; i < zeros; i++ {
				words = append(words, 0)
			}
		}
	}
	return words, len(words) == 8
}

// isPrivateIPv6 permits native global unicast only, excluding documentation,
// benchmarking and the known Hysteria TUN subnet. IPv4-mapped literals cannot
// disguise private IPv4 routes. Other Teredo addresses remain available.
// Keep this policy aligned with TweetWeb's publicIpAddressBaseUrl.
func isPrivateIPv6(ip string) bool {
	clean := ip
	if strings.HasPrefix(clean, "[") {
		if end := strings.Index(clean, "]"); end >= 0 {
			clean = clean[1:end]
		}
	}
	words, ok := ipv6Words(clean)
	if !ok {
		return true
	}
	return words[0] < 0x2000 || words[0] > 0x3fff ||
		(words[0] == 0x2001 && words[1] == 0xdb8) || // Documentation
		(words[0] == 0x3fff && words[1] < 0x1000) || // Documentation
		(words[0] == 0x2001 && words[1] == 2 && words[2] == 0) || // Benchmarking
		(words[0] == 0x2001 && words[1] == 0 && words[2] == 0 && words[3] == 0 &&
			words[4] == 0xffff && words[5] == 0xffff && words[6] == 0xffff &&
			words[7] >= 0xfff0 && words[7] <= 0xfff3) // Hysteria TUN /126
}

// usableAddress reports whether an announced address is worth handing to a
// client: public, and IPv4 when the caller can only use IPv4.
func usableAddress(addr string, v4Only bool) bool {
	// Classify the complete address: splitting first mistakes a bare IPv6
	// address's final numeric group for a port (for example, ::1 becomes :).
	if isPrivateIP(addr) {
		return false
	}
	if v4Only && isIPv6(addr) {
		return false
	}
	return true
}

// validIPAddress admits literal IPs of the requested family for a node's
// private-only fallback, without admitting malformed values or hostnames.
func validIPAddress(addr string, v4Only bool) bool {
	if isIPv6(addr) {
		if v4Only {
			return false
		}
		host := addr
		if strings.HasPrefix(addr, "[") {
			host, _ = splitHostPort(addr)
		}
		_, ok := ipv6Words(host)
		return ok
	}
	host, _ := splitHostPort(addr)
	_, ok := ipv4Octets(host)
	return ok
}
