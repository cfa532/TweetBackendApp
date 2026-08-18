// base64.go — base64 decoding for agent-authentication material.
//
// Agent signatures and public keys arrive base64 encoded. encoding/base64 is
// not assumed to be available under the ixgo interpreter, and the JavaScript
// implementation hand-rolled the same decoder for the same reason.
//
// Both the standard alphabet and the URL-safe variant are accepted, and padding
// is optional, because the clients are not consistent about either.
package lapp

import (
	"fmt"
	"strings"
)

const base64Std = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

// base64Decode decodes a base64 string to bytes.
func base64Decode(s string) ([]byte, error) {
	// Normalise the URL-safe alphabet onto the standard one and drop padding,
	// which carries no information once the input length is known.
	s = strings.TrimRight(strings.NewReplacer("-", "+", "_", "/").Replace(s), "=")
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, s)
	if s == "" {
		return nil, nil
	}
	if len(s)%4 == 1 {
		return nil, fmt.Errorf("invalid base64 length %d", len(s))
	}

	out := make([]byte, 0, len(s)*3/4)
	var quad [4]int
	for i := 0; i < len(s); i += 4 {
		n := 0
		for j := 0; j < 4 && i+j < len(s); j++ {
			idx := strings.IndexByte(base64Std, s[i+j])
			if idx < 0 {
				return nil, fmt.Errorf("invalid base64 character %q", s[i+j])
			}
			quad[j] = idx
			n++
		}
		for j := n; j < 4; j++ {
			quad[j] = 0
		}
		out = append(out, byte(quad[0]<<2|quad[1]>>4))
		if n > 2 {
			out = append(out, byte((quad[1]&0x0F)<<4|quad[2]>>2))
		}
		if n > 3 {
			out = append(out, byte((quad[2]&0x03)<<6|quad[3]))
		}
	}
	return out, nil
}
