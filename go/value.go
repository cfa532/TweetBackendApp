// value.go — helpers for the dynamically typed values that cross the lapi
// boundary.
//
// Mimei reads (Get, Hget, Hgetall, MFGetObject) and RunMApp results are all
// typed `any`. The original implementation was JavaScript, so the stored values
// are plain objects, arrays, strings and numbers rather than Go structs, and the
// concrete Go type a value decodes to depends on the transport that carried it.
// These helpers convert at that boundary and nowhere else: entry code below this
// layer works with concrete types.
package lapp

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// toMap normalises an object-like value. The transport may hand back either a
// string-keyed or an interface-keyed map, so both are accepted; a JSON string is
// decoded, which is how objects survive round trips through parameters.
func toMap(v any) (map[string]any, bool) {
	switch t := v.(type) {
	case nil:
		return nil, false
	case map[string]any:
		return t, true
	case map[any]any:
		m := make(map[string]any, len(t))
		for k, val := range t {
			m[fmt.Sprint(k)] = val
		}
		return m, true
	case string:
		if looksLikeJSONObject(t) {
			if m, err := jsonParseObject(t); err == nil {
				return m, true
			}
		}
		return nil, false
	default:
		return nil, false
	}
}

// toSlice normalises an array-like value.
func toSlice(v any) ([]any, bool) {
	switch t := v.(type) {
	case nil:
		return nil, false
	case []any:
		return t, true
	case []string:
		out := make([]any, len(t))
		for i, s := range t {
			out[i] = s
		}
		return out, true
	case string:
		if looksLikeJSONArray(t) {
			if a, err := jsonParseArray(t); err == nil {
				return a, true
			}
		}
		return nil, false
	default:
		return nil, false
	}
}

// toFloat accepts every numeric type the transport may produce.
func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int8:
		return float64(t), true
	case int16:
		return float64(t), true
	case int32:
		return float64(t), true
	case int64:
		return float64(t), true
	case uint:
		return float64(t), true
	case uint8:
		return float64(t), true
	case uint16:
		return float64(t), true
	case uint32:
		return float64(t), true
	case uint64:
		return float64(t), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// toInt64 converts a numeric value, truncating any fractional part.
func toInt64(v any) (int64, bool) {
	f, ok := toFloat(v)
	if !ok {
		return 0, false
	}
	return int64(f), true
}

// toBool mirrors the truthiness the JavaScript code relied on for flags that
// may be stored as booleans, numbers or strings.
func toBool(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != "" && t != "false" && t != "0"
	default:
		if f, ok := toFloat(v); ok {
			return f != 0
		}
		return v != nil
	}
}

// toString renders a value as text. Objects and arrays become JSON so that a
// value can be passed on through a string-typed request parameter.
func toString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		if f, ok := toFloat(v); ok {
			return formatNumber(f)
		}
		return jsonStringify(v)
	}
}

// mapStr reads a string field from an object.
func mapStr(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	return toString(m[key])
}

// mapInt reads an integer field from an object, returning def when absent or
// non-numeric.
func mapInt(m map[string]any, key string, def int64) int64 {
	if m == nil {
		return def
	}
	if n, ok := toInt64(m[key]); ok {
		return n
	}
	return def
}

// mapBool reads a boolean field from an object.
func mapBool(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	return toBool(m[key])
}

// mapArr reads an array field.
func mapArr(m map[string]any, key string) []any {
	if m == nil {
		return nil
	}
	arr, _ := toSlice(m[key])
	return arr
}

// mapStrArr reads an array field as strings, which is the shape of hostIds and
// the various id lists.
func mapStrArr(m map[string]any, key string) []string {
	arr := mapArr(m, key)
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s := toString(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// has reports whether a key is present with a non-nil value.
func has(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	v, ok := m[key]
	return ok && v != nil
}

// strSlice converts strings to the []any form the JSON encoder expects.
func strSlice(items []string) []any {
	out := make([]any, len(items))
	for i, s := range items {
		out[i] = s
	}
	return out
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func looksLikeJSONObject(s string) bool {
	t := strings.TrimSpace(s)
	return strings.HasPrefix(t, "{") && strings.HasSuffix(t, "}")
}

func looksLikeJSONArray(s string) bool {
	t := strings.TrimSpace(s)
	return strings.HasPrefix(t, "[") && strings.HasSuffix(t, "]")
}
