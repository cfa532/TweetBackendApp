// json.go — self-contained JSON codec.
//
// The MApp runs under Leither's ixgo interpreter, which exposes only a limited
// subset of the Go standard library; encoding/json is not assumed to be
// available. The clients (Tweet-iOS, TweetWeb) pass structured values as JSON
// strings in request parameters and expect JSON-shaped values back, so the app
// needs its own encoder/decoder.
//
// Decoded shapes mirror what encoding/json would produce, which is also what
// the original JavaScript implementation worked with:
//
//	object -> map[string]any
//	array  -> []any
//	number -> float64
//	string -> string
//	bool   -> bool
//	null   -> nil
package lapp

import (
	"fmt"
	"strconv"
	"strings"
)

// Surrogate-pair constants, spelled out here because the interpreter does not
// provide unicode/utf16. A non-BMP character is written in JSON as two escapes
// in these ranges, and the pair has to be recombined to recover the rune.
const (
	surrogateHighMin = 0xD800
	surrogateHighMax = 0xDBFF
	surrogateLowMin  = 0xDC00
	surrogateLowMax  = 0xDFFF
	surrogateOffset  = 0x10000
	// runeError is U+FFFD, substituted for an unpaired surrogate.
	runeError = 0xFFFD
)

// isSurrogate reports whether r is either half of a surrogate pair.
func isSurrogate(r rune) bool {
	return r >= surrogateHighMin && r <= surrogateLowMax
}

// combineSurrogates joins a high and low surrogate into the rune they encode,
// returning runeError when the pair is not well formed.
func combineSurrogates(high, low rune) rune {
	if high < surrogateHighMin || high > surrogateHighMax ||
		low < surrogateLowMin || low > surrogateLowMax {
		return runeError
	}
	return surrogateOffset + (high-surrogateHighMin)<<10 + (low - surrogateLowMin)
}

// jsonParse decodes a JSON document. It is the counterpart of JS JSON.parse.
func jsonParse(s string) (any, error) {
	d := &jsonDecoder{src: s}
	d.skipSpace()
	v, err := d.value()
	if err != nil {
		return nil, err
	}
	d.skipSpace()
	if d.pos != len(d.src) {
		return nil, fmt.Errorf("unexpected trailing data at offset %d", d.pos)
	}
	return v, nil
}

// jsonParseObject decodes a JSON document that must be an object. Most request
// parameters (user, tweet, comment...) arrive in this form.
func jsonParseObject(s string) (map[string]any, error) {
	v, err := jsonParse(s)
	if err != nil {
		return nil, err
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected a JSON object, got %T", v)
	}
	return m, nil
}

// jsonParseArray decodes a JSON document that must be an array.
func jsonParseArray(s string) ([]any, error) {
	v, err := jsonParse(s)
	if err != nil {
		return nil, err
	}
	a, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("expected a JSON array, got %T", v)
	}
	return a, nil
}

type jsonDecoder struct {
	src string
	pos int
}

func (d *jsonDecoder) skipSpace() {
	for d.pos < len(d.src) {
		switch d.src[d.pos] {
		case ' ', '\t', '\n', '\r':
			d.pos++
		default:
			return
		}
	}
}

func (d *jsonDecoder) value() (any, error) {
	if d.pos >= len(d.src) {
		return nil, fmt.Errorf("unexpected end of JSON input")
	}
	switch c := d.src[d.pos]; {
	case c == '{':
		return d.object()
	case c == '[':
		return d.array()
	case c == '"':
		return d.stringLit()
	case c == 't':
		return true, d.literal("true")
	case c == 'f':
		return false, d.literal("false")
	case c == 'n':
		return nil, d.literal("null")
	case c == '-' || (c >= '0' && c <= '9'):
		return d.number()
	default:
		return nil, fmt.Errorf("unexpected character %q at offset %d", c, d.pos)
	}
}

func (d *jsonDecoder) literal(word string) error {
	if !strings.HasPrefix(d.src[d.pos:], word) {
		return fmt.Errorf("invalid literal at offset %d", d.pos)
	}
	d.pos += len(word)
	return nil
}

func (d *jsonDecoder) object() (map[string]any, error) {
	d.pos++ // consume '{'
	obj := map[string]any{}
	d.skipSpace()
	if d.pos < len(d.src) && d.src[d.pos] == '}' {
		d.pos++
		return obj, nil
	}
	for {
		d.skipSpace()
		if d.pos >= len(d.src) || d.src[d.pos] != '"' {
			return nil, fmt.Errorf("expected object key at offset %d", d.pos)
		}
		key, err := d.stringLit()
		if err != nil {
			return nil, err
		}
		d.skipSpace()
		if d.pos >= len(d.src) || d.src[d.pos] != ':' {
			return nil, fmt.Errorf("expected ':' at offset %d", d.pos)
		}
		d.pos++
		d.skipSpace()
		val, err := d.value()
		if err != nil {
			return nil, err
		}
		obj[key] = val
		d.skipSpace()
		if d.pos >= len(d.src) {
			return nil, fmt.Errorf("unexpected end of JSON object")
		}
		switch d.src[d.pos] {
		case ',':
			d.pos++
		case '}':
			d.pos++
			return obj, nil
		default:
			return nil, fmt.Errorf("expected ',' or '}' at offset %d", d.pos)
		}
	}
}

func (d *jsonDecoder) array() ([]any, error) {
	d.pos++ // consume '['
	arr := []any{}
	d.skipSpace()
	if d.pos < len(d.src) && d.src[d.pos] == ']' {
		d.pos++
		return arr, nil
	}
	for {
		d.skipSpace()
		val, err := d.value()
		if err != nil {
			return nil, err
		}
		arr = append(arr, val)
		d.skipSpace()
		if d.pos >= len(d.src) {
			return nil, fmt.Errorf("unexpected end of JSON array")
		}
		switch d.src[d.pos] {
		case ',':
			d.pos++
		case ']':
			d.pos++
			return arr, nil
		default:
			return nil, fmt.Errorf("expected ',' or ']' at offset %d", d.pos)
		}
	}
}

func (d *jsonDecoder) stringLit() (string, error) {
	d.pos++ // consume opening quote
	var sb strings.Builder
	for d.pos < len(d.src) {
		c := d.src[d.pos]
		switch {
		case c == '"':
			d.pos++
			return sb.String(), nil
		case c == '\\':
			d.pos++
			if d.pos >= len(d.src) {
				return "", fmt.Errorf("unexpected end of string escape")
			}
			switch d.src[d.pos] {
			case '"':
				sb.WriteByte('"')
			case '\\':
				sb.WriteByte('\\')
			case '/':
				sb.WriteByte('/')
			case 'b':
				sb.WriteByte('\b')
			case 'f':
				sb.WriteByte('\f')
			case 'n':
				sb.WriteByte('\n')
			case 'r':
				sb.WriteByte('\r')
			case 't':
				sb.WriteByte('\t')
			case 'u':
				r, err := d.unicodeEscape()
				if err != nil {
					return "", err
				}
				sb.WriteRune(r)
				continue
			default:
				return "", fmt.Errorf("invalid escape %q at offset %d", d.src[d.pos], d.pos)
			}
			d.pos++
		default:
			sb.WriteByte(c)
			d.pos++
		}
	}
	return "", fmt.Errorf("unterminated string")
}

// unicodeEscape reads \uXXXX (already positioned on the 'u') and joins a
// surrogate pair when one follows, so non-BMP characters such as emoji in tweet
// text survive the round trip.
func (d *jsonDecoder) unicodeEscape() (rune, error) {
	r, err := d.hex4()
	if err != nil {
		return 0, err
	}
	if isSurrogate(rune(r)) && strings.HasPrefix(d.src[d.pos:], `\u`) {
		save := d.pos
		d.pos += 2
		r2, err := d.hex4()
		if err != nil {
			return 0, err
		}
		if combined := combineSurrogates(rune(r), rune(r2)); combined != runeError {
			return combined, nil
		}
		d.pos = save
	}
	return rune(r), nil
}

// hex4 consumes the 4 hex digits of a \u escape; on entry pos points at 'u'.
func (d *jsonDecoder) hex4() (uint64, error) {
	if d.pos+5 > len(d.src) {
		return 0, fmt.Errorf("truncated \\u escape at offset %d", d.pos)
	}
	n, err := strconv.ParseUint(d.src[d.pos+1:d.pos+5], 16, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid \\u escape at offset %d", d.pos)
	}
	d.pos += 5
	return n, nil
}

func (d *jsonDecoder) number() (float64, error) {
	start := d.pos
	if d.pos < len(d.src) && d.src[d.pos] == '-' {
		d.pos++
	}
	for d.pos < len(d.src) {
		c := d.src[d.pos]
		if (c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-' {
			d.pos++
			continue
		}
		break
	}
	f, err := strconv.ParseFloat(d.src[start:d.pos], 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number at offset %d", start)
	}
	return f, nil
}

// jsonStringify encodes a value as JSON. It is the counterpart of JS
// JSON.stringify and accepts the dynamically typed values that come back from
// the Mimei database.
//
// Map keys are emitted in sorted order so that a given value always produces
// the same bytes; clients parse the result rather than compare it, but stable
// output keeps logs and signatures reproducible.
func jsonStringify(v any) string {
	var sb strings.Builder
	encodeJSON(&sb, v)
	return sb.String()
}

func encodeJSON(sb *strings.Builder, v any) {
	switch t := v.(type) {
	case nil:
		sb.WriteString("null")
	case bool:
		if t {
			sb.WriteString("true")
		} else {
			sb.WriteString("false")
		}
	case string:
		encodeJSONString(sb, t)
	case []any:
		sb.WriteByte('[')
		for i, item := range t {
			if i > 0 {
				sb.WriteByte(',')
			}
			encodeJSON(sb, item)
		}
		sb.WriteByte(']')
	case []string:
		sb.WriteByte('[')
		for i, item := range t {
			if i > 0 {
				sb.WriteByte(',')
			}
			encodeJSONString(sb, item)
		}
		sb.WriteByte(']')
	case map[string]any:
		sb.WriteByte('{')
		for i, k := range sortedKeys(t) {
			if i > 0 {
				sb.WriteByte(',')
			}
			encodeJSONString(sb, k)
			sb.WriteByte(':')
			encodeJSON(sb, t[k])
		}
		sb.WriteByte('}')
	default:
		// Numbers arrive in many concrete types depending on whether a value
		// came from the database, a literal, or a decoded document.
		if f, ok := toFloat(v); ok {
			sb.WriteString(formatNumber(f))
			return
		}
		if m, ok := toMap(v); ok {
			encodeJSON(sb, m)
			return
		}
		if a, ok := toSlice(v); ok {
			encodeJSON(sb, a)
			return
		}
		encodeJSONString(sb, fmt.Sprint(v))
	}
}

func encodeJSONString(sb *strings.Builder, s string) {
	sb.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			sb.WriteString(`\"`)
		case '\\':
			sb.WriteString(`\\`)
		case '\n':
			sb.WriteString(`\n`)
		case '\r':
			sb.WriteString(`\r`)
		case '\t':
			sb.WriteString(`\t`)
		case '\b':
			sb.WriteString(`\b`)
		case '\f':
			sb.WriteString(`\f`)
		default:
			if r < 0x20 {
				sb.WriteString(`\u`)
				const hexDigits = "0123456789abcdef"
				sb.WriteByte('0')
				sb.WriteByte('0')
				sb.WriteByte(hexDigits[(r>>4)&0xF])
				sb.WriteByte(hexDigits[r&0xF])
				continue
			}
			sb.WriteRune(r)
		}
	}
	sb.WriteByte('"')
}

// formatNumber renders a float the way JSON.stringify does: whole numbers lose
// their fractional part, so a millisecond timestamp stays an integer literal.
func formatNumber(f float64) string {
	if f == float64(int64(f)) && f < 1e15 && f > -1e15 {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}
