package lapp

import (
	"strings"
	"testing"
)

func TestJSONRoundTrip(t *testing.T) {
	cases := []string{
		`{"a":1,"b":"x","c":true,"d":null,"e":[1,2,3],"f":{"g":"h"}}`,
		`{"attachments":[{"mid":"abc","timestamp":1700000000000}],"content":"hi"}`,
		`[]`,
		`{}`,
		`{"n":-12.5,"big":9007199254740991}`,
		`{"s":"line\nbreak\ttab \"quoted\" back\\slash"}`,
		`{"emoji":"a😀b","cn":"中文"}`,
	}
	for _, src := range cases {
		v, err := jsonParse(src)
		if err != nil {
			t.Fatalf("parse %s: %v", src, err)
		}
		out := jsonStringify(v)
		again, err := jsonParse(out)
		if err != nil {
			t.Fatalf("reparse %s: %v", out, err)
		}
		if jsonStringify(again) != out {
			t.Fatalf("unstable round trip: %s -> %s", src, out)
		}
	}
}

func TestJSONIntegersStayIntegers(t *testing.T) {
	// Timestamps must not gain a fractional part; clients parse them as ints.
	v, err := jsonParse(`{"timestamp":1700000000000}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := jsonStringify(v); got != `{"timestamp":1700000000000}` {
		t.Fatalf("got %s", got)
	}
}

func TestJSONSortsKeysAtEveryLevel(t *testing.T) {
	// Agent signatures are computed over this exact rendering.
	v := map[string]any{
		"timestamp": int64(5),
		"authorId":  "u1",
		"nested":    map[string]any{"z": 1, "a": 2},
		"content":   "c",
	}
	want := `{"authorId":"u1","content":"c","nested":{"a":2,"z":1},"timestamp":5}`
	if got := jsonStringify(v); got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestJSONEscapedUnicode(t *testing.T) {
	v, err := jsonParse(`{"s":"中😀"}`)
	if err != nil {
		t.Fatal(err)
	}
	m := v.(map[string]any)
	if m["s"] != "中😀" {
		t.Fatalf("got %q", m["s"])
	}
}

func TestJSONRejectsGarbage(t *testing.T) {
	for _, src := range []string{`{`, `{"a":}`, `[1,2`, `nope`, `{"a":1}x`, ``} {
		if _, err := jsonParse(src); err == nil {
			t.Fatalf("expected error for %q", src)
		}
	}
}

func TestBase64Decode(t *testing.T) {
	cases := map[string]string{
		"":         "",
		"aGk=":     "hi",
		"aGk":      "hi",
		"aGVsbG8=": "hello",
		"aGVsbG8h": "hello!",
		"YQ==":     "a",
		"c3VyZS4=": "sure.",
		"YS1iX2M=": "a-b_c",
		"8J-YgA==": "\xf0\x9f\x98\x80", // URL-safe alphabet
		"8J+YgA==": "\xf0\x9f\x98\x80", // standard alphabet
	}
	for in, want := range cases {
		got, err := base64Decode(in)
		if err != nil {
			t.Fatalf("decode %q: %v", in, err)
		}
		if string(got) != want {
			t.Fatalf("decode %q = %q, want %q", in, got, want)
		}
	}
}

func TestBase64SignatureLength(t *testing.T) {
	// 64 zero bytes, the shape an Ed25519 signature must have.
	sig := ""
	for i := 0; i < 86; i++ {
		sig += "A"
	}
	got, err := base64Decode(sig)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 64 {
		t.Fatalf("decoded length %d, want 64", len(got))
	}
}

func TestAddressFiltering(t *testing.T) {
	cases := []struct {
		addr   string
		v4Only bool
		usable bool
	}{
		{"115.205.180.247:8002", false, true},
		{"192.168.10.5:8002", false, false},
		{"10.0.0.1:8002", false, false},
		{"172.16.5.5:8002", false, false},
		{"172.32.5.5:8002", false, true},
		{"127.0.0.1:8002", false, false},
		{"169.254.1.1:8002", false, false},
		{"26.26.26.9:8002", false, false},
		{"[240e:391:edd:26d0::1]:8002", false, true},
		{"[240e:391:edd:26d0::1]:8002", true, false},
		{"[fd00::1]:8002", false, false},
		{"[fe80::1]:8002", false, false},
		{"[::1]:8002", false, false},
		{"115.205.180.247:8002", true, true},
	}
	for _, tc := range cases {
		if got := usableAddress(tc.addr, tc.v4Only); got != tc.usable {
			t.Fatalf("usableAddress(%q, v4Only=%v) = %v, want %v",
				tc.addr, tc.v4Only, got, tc.usable)
		}
	}
}

func TestSplitHostPort(t *testing.T) {
	cases := []struct {
		in   string
		host string
		port int
	}{
		{"1.2.3.4:80", "1.2.3.4", 80},
		{"1.2.3.4", "1.2.3.4", 0},
		{"[2001:db8::1]:8080", "2001:db8::1", 8080},
		{"[2001:db8::1]", "2001:db8::1", 0},
		{"[2001:db8::1]:0", "2001:db8::1", 0},
		// An unbracketed IPv6 ending in digits cannot be told apart from
		// host:port. This documents the accepted behaviour; see splitHostPort.
		{"2001:db8::1", "2001:db8:", 1},
		// Unbracketed IPv6 not ending in a numeric group keeps its whole value.
		{"2001:db8::abcd", "2001:db8::abcd", 0},
	}
	for _, tc := range cases {
		host, port := splitHostPort(tc.in)
		if host != tc.host || port != tc.port {
			t.Fatalf("splitHostPort(%q) = (%q,%d), want (%q,%d)", tc.in, host, port, tc.host, tc.port)
		}
	}
}

func TestValueCoercion(t *testing.T) {
	if n, ok := toInt64("1700000000000"); !ok || n != 1700000000000 {
		t.Fatalf("toInt64 string: %d %v", n, ok)
	}
	if n, ok := toInt64(float64(42)); !ok || n != 42 {
		t.Fatalf("toInt64 float: %d %v", n, ok)
	}
	if _, ok := toInt64("abc"); ok {
		t.Fatal("toInt64 should reject non-numeric")
	}
	if !toBool("true") || toBool("false") || toBool("") || toBool(nil) {
		t.Fatal("toBool string handling")
	}
	m, ok := toMap(`{"a":1}`)
	if !ok || mapInt(m, "a", 0) != 1 {
		t.Fatal("toMap from JSON string")
	}
	if got := mapStrArr(map[string]any{"hostIds": []any{"a", "b"}}, "hostIds"); len(got) != 2 || got[0] != "a" {
		t.Fatalf("mapStrArr: %v", got)
	}
}

func TestValidUsername(t *testing.T) {
	good := []string{"abc", "a_b-c", "User123", "a"}
	bad := []string{"", "has space", "sym!bol", "way_too_long_username_here", "中文"}
	for _, s := range good {
		if !validUsername(s) {
			t.Fatalf("%q should be valid", s)
		}
	}
	for _, s := range bad {
		if validUsername(s) {
			t.Fatalf("%q should be invalid", s)
		}
	}
}

func TestValidAccessFailure(t *testing.T) {
	now := int64(1_700_000_000_000)
	ok := map[string]any{"firstFailedAt": now - 1000, "lastFailedAt": now - 500, "attempts": 3}
	if !validAccessFailure(ok, now) {
		t.Fatal("valid record rejected")
	}
	bad := []map[string]any{
		{"firstFailedAt": 0, "lastFailedAt": now, "attempts": 3},
		{"firstFailedAt": now + 1000, "lastFailedAt": now, "attempts": 3},
		{"firstFailedAt": now - 1000, "lastFailedAt": now - 2000, "attempts": 3},
		{"firstFailedAt": now - 1000, "lastFailedAt": now, "attempts": 0},
	}
	for i, rec := range bad {
		if validAccessFailure(rec, now) {
			t.Fatalf("invalid record %d accepted", i)
		}
	}
}

func TestEveryEntryIsRegistered(t *testing.T) {
	// A missing entry is only discovered at call time otherwise.
	if len(entryTable()) == 0 {
		t.Fatal("no entries registered")
	}
	for name, fn := range entryTable() {
		if fn == nil {
			t.Fatalf("entry %s has no implementation", name)
		}
	}
}

func TestRedactParam(t *testing.T) {
	if got := redactParam("password", "hunter2"); got != redactedMark {
		t.Fatalf("password not redacted: %q", got)
	}
	// The user blob keeps its other fields so the log stays useful.
	got := redactParam("user", `{"username":"bob","password":"hunter2","name":"Bob"}`)
	if strings.Contains(got, "hunter2") {
		t.Fatalf("password leaked through user blob: %s", got)
	}
	if !strings.Contains(got, "bob") || !strings.Contains(got, redactedMark) {
		t.Fatalf("user blob over-redacted: %s", got)
	}
	// An unparseable blob is redacted whole rather than logged blind.
	if got := redactParam("user", "not json but password=hunter2"); got != redactedMark {
		t.Fatalf("unparseable blob not redacted: %q", got)
	}
	if got := redactParam("agentAuth", `{"mimeiId":"m1","signature":"AAAA"}`); strings.Contains(got, "AAAA") {
		t.Fatalf("signature leaked: %s", got)
	}
	// Non-secret parameters pass through untouched.
	if got := redactParam("tweetid", "abc"); got != "abc" {
		t.Fatalf("non-secret altered: %q", got)
	}
	if got := redactParam("password", ""); got != "" {
		t.Fatalf("empty value should stay empty: %q", got)
	}
}
