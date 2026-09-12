// Storage operations dispatch per object; legacy databases retain their keys and MIDs.
package lapp

import (
	"fmt"

	"Leither/lapi"
)

// ---------------------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------------------

// readMimei opens mid for reading and runs fn against the handle.
func (c *ctx) readMimei(sid, mid string, fn func(mmsid string) error) error {
	if mid == "" {
		return fmt.Errorf("readMimei: empty mid")
	}
	mmsid, err := c.openMimei(sid, mid, verLast)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, last): %v", mid, err)
	}
	defer c.closeMimei(mmsid)
	return fn(mmsid)
}

// closeMimei releases a handle. A failure here cannot be acted on by the caller
// and must not mask the operation's own result, so it is logged.
func (c *ctx) closeMimei(mmsid string) {
	if mmsid == "" {
		return
	}
	delete(c.files, mmsid)
	if err := c.api.MMClose(mmsid); err != nil {
		c.warnf("MMClose failed: %v", err)
	}
}

// backup commits the current version as a new "last".
func (c *ctx) backup(sid, mid, memo string, opts ...string) error {
	if f := c.files[sid]; f != nil && f.mid == mid {
		return c.commitFile(f)
	}
	for _, f := range c.files {
		if f.mid == mid && f.writable {
			return c.commitFile(f)
		}
	}
	if _, err := c.api.MMBackup(sid, mid, memo, opts...); err != nil {
		return fmt.Errorf("MMBackup(%s): %v", mid, err)
	}
	return nil
}

// backupDelRef commits a revision, passing the "delref=false" option that the
// JavaScript version passes on all 39 of its MMBackup calls.
//
// What that option does is unverified, and on V0.24.02 it appears to do nothing.
// MMBackup's fourth parameter is a variadic ...string that the published
// api/MiMei.md does not document at all. Probed on a live node against the
// reference list read back with MMGetRef, these four are indistinguishable:
// no option, "delref=false", "delref=true", and the nonsense option
// "zzz=nonsense" — which is accepted without error. Both a plain re-backup and
// an MMAddRef/MMDelRef cycle produced identical reference maps in every arm.
//
// It is kept because the JavaScript passes it everywhere, because an unknown
// option is ignored rather than rejected, and because a later node build may
// give it meaning. Do not read the name as a description of behaviour: nothing
// here has been shown to delete a reference.
func (c *ctx) backupDelRef(sid, mid, memo string) error {
	return c.backup(sid, mid, memo, "delref=false")
}

// ---------------------------------------------------------------------------
// Object creation
// ---------------------------------------------------------------------------

// createDatabase creates a Mimei database object and returns its mid.
func (c *ctx) createDatabase(sid, mark string) (string, error) {
	mid, err := c.api.MMCreate(sid, c.appID(), appExt, mark, mimeiTypeDatabase, rightUserObject)
	if err != nil {
		return "", fmt.Errorf("MMCreate(%s): %v", mark, err)
	}
	return mid, nil
}

// contentID derives a stable id from a value by creating a content-addressed
// Mimei for it. The same input always yields the same id, which is how the
// original implementation stored passwords: the id is kept, the value is not.
func (c *ctx) contentID(sid, value string) (string, error) {
	id, err := c.api.MMCreate(sid, c.appID(), appExt, value, mimeiTypeFile, rightUserObject)
	if err != nil {
		return "", fmt.Errorf("MMCreate(content): %v", err)
	}
	return id, nil
}

// ---------------------------------------------------------------------------
// Scalar values
// ---------------------------------------------------------------------------

// getValue reads a raw key.
func (c *ctx) getValue(mmsid, key string) (any, error) {
	if f := c.files[mmsid]; f != nil {
		return c.fileValue(f, key)
	}

	v, err := c.api.Get(mmsid, key)
	if err != nil {
		return nil, fmt.Errorf("Get(%s): %v", key, err)
	}
	return v, nil
}

// getObject reads a key holding an object. A missing key yields (nil, nil) so
// callers can distinguish "absent" from "failed".
func (c *ctx) getObject(mmsid, key string) (map[string]any, error) {
	v, err := c.getValue(mmsid, key)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, nil
	}
	m, ok := toMap(v)
	if !ok {
		return nil, fmt.Errorf("value at %s is not an object (%T)", key, v)
	}
	return m, nil
}

// setValue writes a raw key.
func (c *ctx) setValue(mmsid, key string, value any) error {
	if f := c.files[mmsid]; f != nil {
		return c.fileSetValue(f, key, value)
	}

	if err := c.api.Set(mmsid, key, value); err != nil {
		return fmt.Errorf("Set(%s): %v", key, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Hashes — used for the membership lists (followers, bookmarks, comments...)
// ---------------------------------------------------------------------------

// hset adds or updates a field.
func (c *ctx) hset(mmsid, key, field string, value any) error {
	if f := c.files[mmsid]; f != nil {
		return c.fileSetMember(f, key, field, "value", value)
	}

	if _, err := c.api.Hset(mmsid, key, field, value); err != nil {
		return fmt.Errorf("Hset(%s.%s): %v", key, field, err)
	}
	return nil
}

// hget reads a field; a missing field yields (nil, nil).
func (c *ctx) hget(mmsid, key, field string) (any, error) {
	if f := c.files[mmsid]; f != nil {
		entry, err := c.fileMember(f, key, field)
		if err != nil {
			return nil, err
		}
		return entry["value"], nil
	}

	v, err := c.api.Hget(mmsid, key, field)
	if err != nil {
		return nil, fmt.Errorf("Hget(%s.%s): %v", key, field, err)
	}
	return v, nil
}

// hhas reports whether a field is present, which is how membership of the
// follower/bookmark/favorite lists is tested.
func (c *ctx) hhas(mmsid, key, field string) (bool, error) {
	v, err := c.hget(mmsid, key, field)
	if err != nil {
		return false, err
	}
	return v != nil, nil
}

// hdel removes fields.
func (c *ctx) hdel(mmsid, key string, fields ...string) error {
	if f := c.files[mmsid]; f != nil {
		for _, field := range fields {
			if err := c.fileDeleteMember(f, key, field, "value"); err != nil {
				return err
			}
		}
		return nil
	}

	if _, err := c.api.Hdel(mmsid, key, fields...); err != nil {
		return fmt.Errorf("Hdel(%s.%v): %v", key, fields, err)
	}
	return nil
}

// hlen counts fields.
func (c *ctx) hlen(mmsid, key string) (int64, error) {
	if f := c.files[mmsid]; f != nil {
		pairs, err := c.fileHash(f, key)
		return int64(len(pairs)), err
	}

	n, err := c.api.Hlen(mmsid, key)
	if err != nil {
		return 0, fmt.Errorf("Hlen(%s): %v", key, err)
	}
	return n, nil
}

// hkeys lists field names.
func (c *ctx) hkeys(mmsid, key string) ([]string, error) {
	if f := c.files[mmsid]; f != nil {
		pairs, err := c.fileHash(f, key)
		if err != nil {
			return nil, err
		}
		out := []string{}
		for _, p := range pairs {
			out = append(out, p.Field)
		}
		return out, nil
	}

	keys, err := c.api.Hkeys(mmsid, key)
	if err != nil {
		return nil, fmt.Errorf("Hkeys(%s): %v", key, err)
	}
	return keys, nil
}

// ---------------------------------------------------------------------------
// Sorted sets — used for time-ordered lists (a user's tweets, feeds)
// ---------------------------------------------------------------------------

// zadd inserts a member with an explicit score.
func (c *ctx) zadd(mmsid, key string, score int64, member string) error {
	if f := c.files[mmsid]; f != nil {
		return c.fileSetMember(f, key, member, "score", toString(score))
	}

	if _, err := c.api.Zadd(mmsid, key, lapi.ScorePair{Score: score, Member: member}); err != nil {
		return fmt.Errorf("Zadd(%s): %v", key, err)
	}
	return nil
}

// zaddSeq appends members scored by the database's own sequence, giving a
// stable insertion order without the caller inventing timestamps.
func (c *ctx) zaddSeq(mmsid, key string, members ...string) error {
	if f := c.files[mmsid]; f != nil {
		if len(members) == 0 {
			return nil
		}
		// Keep a high-water mark even when the newest member is removed.
		path := "sequences/" + fileSegment(key) + ".json"
		state, err := c.fileJSON(f, path)
		if err != nil {
			return err
		}
		seq := int64(0)
		if state != nil {
			var ok bool
			seq, ok = toInt64(state["value"])
			if !ok {
				return fmt.Errorf("invalid sequence for %s", key)
			}
		}
		pairs, err := c.fileScores(f, key, false)
		if err != nil {
			return err
		}
		if len(pairs) > 0 && pairs[len(pairs)-1].Score > seq {
			seq = pairs[len(pairs)-1].Score
		}
		for _, member := range members {
			if seq == int64(9223372036854775807) {
				return fmt.Errorf("sequence exhausted for %s", key)
			}
			seq++
			if err := c.zadd(mmsid, key, seq, member); err != nil {
				return err
			}
		}
		return c.fileSet(f, path, map[string]any{"value": toString(seq)})
	}

	if len(members) == 0 {
		return nil
	}
	if _, err := c.api.Zaddwithseq(mmsid, key, members...); err != nil {
		return fmt.Errorf("Zaddwithseq(%s): %v", key, err)
	}
	return nil
}

// zrem removes members.
func (c *ctx) zrem(mmsid, key string, members ...string) error {
	if f := c.files[mmsid]; f != nil {
		for _, member := range members {
			if err := c.fileDeleteMember(f, key, member, "score"); err != nil {
				return err
			}
		}
		return nil
	}

	if len(members) == 0 {
		return nil
	}
	if _, err := c.api.Zrem(mmsid, key, members...); err != nil {
		return fmt.Errorf("Zrem(%s): %v", key, err)
	}
	return nil
}

// zcard counts members.
func (c *ctx) zcard(mmsid, key string) (int64, error) {
	if f := c.files[mmsid]; f != nil {
		pairs, err := c.fileScores(f, key, false)
		return int64(len(pairs)), err
	}

	n, err := c.api.Zcard(mmsid, key)
	if err != nil {
		return 0, fmt.Errorf("Zcard(%s): %v", key, err)
	}
	return n, nil
}

// zscore reads a member's score.
func (c *ctx) zscore(mmsid, key, member string) (int64, error) {
	if f := c.files[mmsid]; f != nil {
		entry, err := c.fileMember(f, key, member)
		if err != nil {
			return 0, err
		}
		if entry == nil || !has(entry, "score") {
			return 0, nil
		}
		score, ok := toInt64(entry["score"])
		if !ok {
			return 0, fmt.Errorf("invalid score")
		}
		return score, nil
	}

	n, err := c.api.Zscore(mmsid, key, member)
	if err != nil {
		return 0, fmt.Errorf("Zscore(%s.%s): %v", key, member, err)
	}
	return n, nil
}

// zrank reads a member's position.
func (c *ctx) zrank(mmsid, key, member string) (int64, error) {
	if f := c.files[mmsid]; f != nil {
		pairs, err := c.fileScores(f, key, false)
		if err != nil {
			return 0, err
		}
		for i, pair := range pairs {
			if pair.Member == member {
				return int64(i), nil
			}
		}
		return -1, nil
	}

	n, err := c.api.Zrank(mmsid, key, member)
	if err != nil {
		return 0, fmt.Errorf("Zrank(%s.%s): %v", key, member, err)
	}
	return n, nil
}

// zrevrange lists members newest first, which is the order every timeline is
// presented in.
func (c *ctx) zrevrange(mmsid, key string, start, stop int) ([]lapi.ScorePair, error) {
	if f := c.files[mmsid]; f != nil {
		pairs, err := c.fileScores(f, key, true)
		if err != nil {
			return nil, err
		}
		return fileScoreRange(pairs, start, stop), nil
	}

	pairs, err := c.api.Zrevrange(mmsid, key, start, stop)
	if err != nil {
		return nil, fmt.Errorf("Zrevrange(%s): %v", key, err)
	}
	return pairs, nil
}

// zrange lists members oldest first.
func (c *ctx) zrange(mmsid, key string, start, stop int) ([]lapi.ScorePair, error) {
	if f := c.files[mmsid]; f != nil {
		pairs, err := c.fileScores(f, key, false)
		if err != nil {
			return nil, err
		}
		return fileScoreRange(pairs, start, stop), nil
	}

	pairs, err := c.api.Zrange(mmsid, key, start, stop)
	if err != nil {
		return nil, fmt.Errorf("Zrange(%s): %v", key, err)
	}
	return pairs, nil
}

// zrangebyscore lists members within a score window.
func (c *ctx) zrangebyscore(mmsid, key string, min, max int64, offset, count int) ([]lapi.ScorePair, error) {
	if f := c.files[mmsid]; f != nil {
		pairs, err := c.fileScores(f, key, false)
		if err != nil {
			return nil, err
		}
		out := []lapi.ScorePair{}
		for _, pair := range pairs {
			if pair.Score >= min && pair.Score <= max {
				out = append(out, pair)
			}
		}
		if offset < 0 {
			offset = 0
		}
		if offset >= len(out) || count == 0 {
			return []lapi.ScorePair{}, nil
		}
		out = out[offset:]
		if count > 0 && len(out) > count {
			out = out[:count]
		}
		return out, nil
	}

	pairs, err := c.api.Zrangebyscore(mmsid, key, min, max, offset, count)
	if err != nil {
		return nil, fmt.Errorf("Zrangebyscore(%s): %v", key, err)
	}
	return pairs, nil
}

// members extracts the member ids from score pairs.
// scorePairValues renders score pairs for a reply.
//
// A []lapi.ScorePair does not survive a cross-node RunMApp: the far side
// receives Go's default formatting of each element — "&{1787586723343 iBa3sq…}"
// — instead of a structure, and cannot read a score or a member out of it.
// Plain maps carry the same field names the JavaScript entry produced, so the
// local caller and the remote one decode the identical shape.
func scorePairValues(pairs []lapi.ScorePair) []any {
	out := make([]any, 0, len(pairs))
	for _, pair := range pairs {
		out = append(out, map[string]any{"Score": pair.Score, "Member": pair.Member})
	}
	return out
}

func members(pairs []lapi.ScorePair) []string {
	out := make([]string, 0, len(pairs))
	for _, p := range pairs {
		out = append(out, p.Member)
	}
	return out
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------
//
// A parent object holds a Mimei reference to each direct child: a user
// references its tweets, a tweet references its comments. Leither synchronises
// one level of references below a synchronised object, so these are what make a
// user's tweets travel with the user. The sorted lists used for pagination do
// not replace them; both must be maintained.

// addRef records a parent -> child reference.
func (c *ctx) addRef(sid, parentMid string, childMids ...string) error {
	if len(childMids) == 0 {
		return nil
	}
	if _, err := c.api.MMAddRef(sid, parentMid, childMids...); err != nil {
		return fmt.Errorf("MMAddRef(%s -> %v): %v", parentMid, childMids, err)
	}
	return nil
}

// delRef drops a parent -> child reference.
func (c *ctx) delRef(sid, parentMid string, childMids ...string) error {
	if len(childMids) == 0 {
		return nil
	}
	if _, err := c.api.MMDelRef(sid, parentMid, childMids...); err != nil {
		return fmt.Errorf("MMDelRef(%s -> %v): %v", parentMid, childMids, err)
	}
	return nil
}

// delVersions removes stored versions of an object, used when deleting content.
func (c *ctx) delVersions(sid, mid string, vers ...string) error {
	if _, err := c.api.MMDelVers(sid, mid, vers...); err != nil {
		return fmt.Errorf("MMDelVers(%s): %v", mid, err)
	}
	return nil
}

func (c *ctx) hgetall(mmsid, key string) ([]lapi.FVPair, error) {
	if f := c.files[mmsid]; f != nil {
		return c.fileHash(f, key)
	}
	return c.api.Hgetall(mmsid, key)
}
func (c *ctx) zaddMany(mmsid, key string, pairs ...lapi.ScorePair) error {
	if c.files[mmsid] != nil {
		for _, pair := range pairs {
			if err := c.zadd(mmsid, key, pair.Score, pair.Member); err != nil {
				return err
			}
		}
		return nil
	}
	_, err := c.api.Zadd(mmsid, key, pairs...)
	return err
}
