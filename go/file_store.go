// File storage keeps core data in one JSON file and each changing membership
// in its own directory entry. Database objects never pass through this adapter.
package lapp

import (
	"Leither/lapi"
	"fmt"
	"sort"
	"strings"
	"time"
)

const fileSchema = "tweet-file-v1"
const fileExtPrefix = "us.fireshare.tweet/file-v1/"
const fileWorkRoot = "/tweet-file-work"

// State belongs to an invocation, not a package global (ixgo does not run
// package initializers). This is read-your-writes staging, not a writer lock.
type fileStore struct {
	mid, kind, auth, handle, root, stage string
	writable                             bool
	changes                              map[string]map[string]any // nil value means delete this entry
	dirs                                 map[string][]lapi.LsLink
}

func (c *ctx) objectKind(sid, mid string) (string, error) {
	if kind := c.createdFiles[mid]; kind != "" {
		return kind, nil
	}
	raw, err := c.api.GetVar(sid, "mminfo", mid)
	if err != nil {
		return "", fmt.Errorf("mminfo(%s): %v", mid, err)
	}
	ext := ""
	switch info := raw.(type) {
	case *lapi.MiMeiInfo:
		if info != nil {
			ext = info.Ext
		}
	case lapi.MiMeiInfo:
		ext = info.Ext
	default:
		m, ok := toMap(raw)
		if !ok {
			return "", fmt.Errorf("invalid MiMei metadata for %s", mid)
		}
		ext = firstNonEmpty(mapStr(m, "Ext"), mapStr(m, "ext"))
	}
	if !strings.HasPrefix(ext, fileExtPrefix) {
		return "", nil
	}
	kind := strings.TrimPrefix(ext, fileExtPrefix)
	switch kind {
	case "user", "tweet", "messages", "node-index":
		return kind, nil
	default:
		return "", fmt.Errorf("unsupported File object kind %q", kind)
	}
}

// Version inspection distinguishes an uncommitted newly created identity from
// failed reads of an existing object. An I/O error never means "create empty".
func (c *ctx) hasCommittedVersion(sid, mid string) (bool, error) {
	raw, err := c.api.GetVar(sid, "mmversions", mid)
	if err != nil {
		return false, err
	}
	if raw == nil {
		return false, nil
	}
	versions, ok := toSlice(raw)
	if !ok {
		return false, fmt.Errorf("invalid version list for %s", mid)
	}
	for _, version := range versions {
		v, ok := version.(string)
		if !ok {
			return false, fmt.Errorf("invalid version for %s", mid)
		}
		if v == "last" {
			return true, nil
		}
	}
	return false, nil
}

// fileObjectID resolves the deterministic identity used by existing File records.
// MMCreate may allocate an uncommitted shell for this lookup; callers must check
// for existing data before selecting it. New records use Database storage.
func (c *ctx) fileObjectID(auth, kind, mark string) (string, error) {
	mid, err := c.api.MMCreate(auth, c.appID(), fileExtPrefix+kind, mark, mimeiTypeFile, rightUserObject)
	if err != nil {
		return "", err
	}
	if c.createdFiles == nil {
		c.createdFiles = map[string]string{}
	}
	c.createdFiles[mid] = kind
	return mid, nil
}

// openMimei retains a native handle for rights/references while dispatching
// record/list operations by the object's immutable creation extension.
func (c *ctx) openMimei(sid, mid, ver string) (string, error) {
	handle, err := c.api.MMOpen(sid, mid, ver)
	if err != nil {
		return "", err
	}
	kind, err := c.objectKind(sid, mid)
	if err != nil {
		c.api.MMClose(handle)
		return "", err
	}
	if kind == "" {
		return handle, nil
	}
	f := &fileStore{mid: mid, kind: kind, auth: sid, handle: handle,
		writable: ver == verCur, changes: map[string]map[string]any{}, dirs: map[string][]lapi.LsLink{}}
	if f.writable {
		// A native author SID, not a database/record handle, owns Files staging.
		f.auth, err = c.authSid()
		if err != nil {
			c.api.MMClose(handle)
			return "", err
		}
		exists, e := c.hasCommittedVersion(f.auth, mid)
		if e != nil {
			c.api.MMClose(handle)
			return "", e
		}
		if exists {
			err = c.pinFileRoot(f, verLast)
		}
	} else {
		err = c.pinFileRoot(f, ver)
	}
	if err != nil {
		c.api.MMClose(handle)
		return "", err
	}
	if c.files == nil {
		c.files = map[string]*fileStore{}
	}
	c.files[handle] = f
	if f.root != "" {
		core, e := c.fileJSON(f, "core.json")
		if e != nil || core == nil || mapStr(core, "schema") != fileSchema || mapStr(core, "kind") != kind || mapStr(core, "mid") != mid {
			c.closeMimei(handle)
			if e != nil {
				return "", e
			}
			return "", fmt.Errorf("invalid %s core record for %s", fileSchema, mid)
		}
	} else {
		f.changes["core.json"] = map[string]any{"schema": fileSchema, "kind": kind, "mid": mid}
	}
	return handle, nil
}

func (c *ctx) pinFileRoot(f *fileStore, ver string) error {
	root := "mm://" + f.mid + ":" + ver
	stat, err := c.api.FilesStat(f.auth, root+"/")
	if err != nil {
		return err
	}
	if stat == nil || !stat.IsDir() || stat.Hash == "" {
		return fmt.Errorf("File object %s is not a directory", f.mid)
	}
	// Keep the versioned MiMei URL as the read source. The installed runtime
	// resolves this tree locally, while its raw /ipfs/<hash> path is not a Files
	// namespace path and fails even when the MiMei's retained tree is present.
	f.root = root
	return nil
}

// Escape only path-unsafe bytes; ordinary MIDs remain readable filenames.
func fileSegment(s string) string {
	const hex = "0123456789abcdef"
	out := ""
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '_' || b == '-' {
			out += string(b)
		} else {
			out += "%" + string(hex[b>>4]) + string(hex[b&15])
		}
	}
	return out
}

func fileSegmentValue(s string) (string, error) {
	out := ""
	for i := 0; i < len(s); i++ {
		if s[i] != '%' {
			out += string(s[i])
			continue
		}
		if i+2 >= len(s) {
			return "", fmt.Errorf("invalid collection filename")
		}
		hi := strings.IndexByte("0123456789abcdef", s[i+1])
		lo := strings.IndexByte("0123456789abcdef", s[i+2])
		if hi < 0 || lo < 0 {
			return "", fmt.Errorf("invalid collection filename")
		}
		out += string(byte(hi*16 + lo))
		i += 2
	}
	return out, nil
}

func collectionPath(key string) string {
	switch key {
	case userTweetList:
		return "tweets"
	case userBookmarkList, tweetBookmarkList:
		return "bookmarks"
	case userFavoriteList, tweetLikeList:
		return "favorites"
	case userCommentList, tweetCommentList:
		return "comments"
	case userFollowingsList:
		return "following"
	case userFollowersList:
		return "followers"
	case tweetRetweetList:
		return "retweets"
	case userPinnedTweets:
		return "pinned"
	case userBlockedUsers:
		return "blocked"
	case userFollowingsTweets:
		return "feed"
	default:
		return "collections/" + fileSegment(key)
	}
}

func scalarPath(key string) string {
	if key == ownerDataKey || key == tweetContentKey {
		return "core.json"
	}
	return "state/" + fileSegment(key) + ".json"
}

// Directory enumeration, rather than treating any failed open as absence,
// distinguishes a missing optional collection from a permissions/I/O failure.
func (c *ctx) fileDirectory(f *fileStore, path string) ([]lapi.LsLink, error) {
	if entries, ok := f.dirs[path]; ok {
		return entries, nil
	}
	if f.root == "" {
		return []lapi.LsLink{}, nil
	}
	if path != "" {
		parent, name := splitFilePath(path)
		entries, err := c.fileDirectory(f, parent)
		if err != nil {
			return nil, err
		}
		found := false
		for _, entry := range entries {
			if entry.Name == name {
				found = true
				if !entry.IsDir() {
					return nil, fmt.Errorf("collection %s is not a directory", path)
				}
				break
			}
		}
		if !found {
			f.dirs[path] = []lapi.LsLink{}
			return f.dirs[path], nil
		}
	}
	entries, err := c.api.FilesLs(f.auth, f.root+"/"+path)
	if err != nil {
		return nil, err
	}
	f.dirs[path] = entries
	return entries, nil
}

func splitFilePath(path string) (string, string) {
	i := strings.LastIndexByte(path, '/')
	if i < 0 {
		return "", path
	}
	return path[:i], path[i+1:]
}

func (c *ctx) fileJSON(f *fileStore, path string) (map[string]any, error) {
	if value, ok := f.changes[path]; ok {
		return value, nil
	}
	parent, name := splitFilePath(path)
	entries, err := c.fileDirectory(f, parent)
	if err != nil {
		return nil, err
	}
	found := false
	for _, entry := range entries {
		if entry.Name == name {
			found = true
			if entry.IsDir() {
				return nil, fmt.Errorf("record %s is a directory", path)
			}
			break
		}
	}
	if !found {
		return nil, nil
	}
	h, err := c.api.MMOpenUrl(f.auth, strings.TrimPrefix(f.root, "/")+"/"+path)
	if err != nil {
		return nil, err
	}
	defer c.api.MMClose(h)
	size, err := c.api.MFGetSize(h)
	if err != nil {
		return nil, err
	}
	if size <= 0 || size > int64(int(^uint(0)>>1)) {
		return nil, fmt.Errorf("invalid record size for %s", path)
	}
	data, err := c.api.MFGetData(h, 0, int(size))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != size {
		return nil, fmt.Errorf("short read of %s", path)
	}
	return jsonParseObject(string(data))
}

func (c *ctx) fileSet(f *fileStore, path string, value map[string]any) error {
	if !f.writable {
		return fmt.Errorf("cannot write committed File object %s", f.mid)
	}
	f.changes[path] = value
	return nil
}

func (c *ctx) fileValue(f *fileStore, key string) (any, error) {
	entry, err := c.fileJSON(f, scalarPath(key))
	if err != nil || entry == nil {
		return nil, err
	}
	value := entry["value"]
	if key == ownerDataKey || key == tweetContentKey {
		if record, ok := toMap(value); ok {
			copy := map[string]any{}
			for k, v := range record {
				copy[k] = v
			}
			copy["storageFormat"] = fileSchema
			return copy, nil
		}
	}
	return value, nil
}

func (c *ctx) fileSetValue(f *fileStore, key string, value any) error {
	entry := map[string]any{"value": value}
	if key == ownerDataKey || key == tweetContentKey {
		record, ok := toMap(value)
		if !ok {
			return fmt.Errorf("core data must be an object")
		}
		core := map[string]any{}
		for k, v := range record {
			core[k] = v
		}
		// Counts and UI membership flags are projections of the directories.
		// Exclude them when accepting a full client model as core data.
		delete(core, "storageFormat")
		fields := []string{"favorites", "bookmarkCount", "favoriteCount", "commentCount", "retweetCount"}
		if key == ownerDataKey {
			fields = []string{"tweetCount", "followingCount", "followersCount", "bookmarksCount", "favoritesCount", "commentsCount",
				"fansList", "followingList", "bookmarkedTweets", "favoriteTweets", "repliedTweets", "commentsList", "topTweets", "userBlackList"}
		}
		for _, field := range fields {
			delete(core, field)
		}
		entry["value"] = core
		entry["schema"], entry["kind"], entry["mid"] = fileSchema, f.kind, f.mid
	}
	return c.fileSet(f, scalarPath(key), entry)
}

// A message's value and order score share one entry. Hash/set APIs are kept at
// the compatibility boundary, not duplicated as two File indexes.
func (c *ctx) fileMember(f *fileStore, key, member string) (map[string]any, error) {
	return c.fileJSON(f, collectionPath(key)+"/"+fileSegment(member)+".json")
}

func (c *ctx) fileSetMember(f *fileStore, key, member, field string, value any) error {
	entry, err := c.fileMember(f, key, member)
	if err != nil {
		return err
	}
	if entry == nil {
		entry = map[string]any{"id": member}
	}
	entry[field] = value
	return c.fileSet(f, collectionPath(key)+"/"+fileSegment(member)+".json", entry)
}

func (c *ctx) fileDeleteMember(f *fileStore, key, member, field string) error {
	entry, err := c.fileMember(f, key, member)
	if err != nil || entry == nil {
		return err
	}
	delete(entry, field)
	if !has(entry, "value") && !has(entry, "score") {
		entry = nil
	}
	return c.fileSet(f, collectionPath(key)+"/"+fileSegment(member)+".json", entry)
}

func (c *ctx) fileMembers(f *fileStore, key string) ([]string, error) {
	dir := collectionPath(key)
	entries, err := c.fileDirectory(f, dir)
	if err != nil {
		return nil, err
	}
	names := map[string]bool{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name, ".json") {
			return nil, fmt.Errorf("invalid entry in %s", dir)
		}
		names[entry.Name] = true
	}
	for path, value := range f.changes {
		parent, name := splitFilePath(path)
		if parent == dir {
			if value == nil {
				delete(names, name)
			} else {
				names[name] = true
			}
		}
	}
	out := []string{}
	for name := range names {
		member, err := fileSegmentValue(strings.TrimSuffix(name, ".json"))
		if err != nil {
			return nil, err
		}
		out = append(out, member)
	}
	sort.Strings(out)
	return out, nil
}

func (c *ctx) fileHash(f *fileStore, key string) ([]lapi.FVPair, error) {
	members, err := c.fileMembers(f, key)
	if err != nil {
		return nil, err
	}
	out := []lapi.FVPair{}
	for _, member := range members {
		entry, err := c.fileMember(f, key, member)
		if err != nil {
			return nil, err
		}
		if value, ok := entry["value"]; ok {
			out = append(out, lapi.FVPair{Field: member, Value: value})
		}
	}
	return out, nil
}

func (c *ctx) fileScores(f *fileStore, key string, reverse bool) ([]lapi.ScorePair, error) {
	members, err := c.fileMembers(f, key)
	if err != nil {
		return nil, err
	}
	out := []lapi.ScorePair{}
	for _, member := range members {
		entry, err := c.fileMember(f, key, member)
		if err != nil {
			return nil, err
		}
		if value, exists := entry["score"]; exists {
			score, ok := toInt64(value)
			if !ok {
				return nil, fmt.Errorf("invalid score in %s/%s", key, member)
			}
			out = append(out, lapi.ScorePair{Member: member, Score: score})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score == out[j].Score {
			if reverse {
				return out[i].Member > out[j].Member
			}
			return out[i].Member < out[j].Member
		}
		if reverse {
			return out[i].Score > out[j].Score
		}
		return out[i].Score < out[j].Score
	})
	return out, nil
}

func fileScoreRange(pairs []lapi.ScorePair, start, stop int) []lapi.ScorePair {
	n := len(pairs)
	if start < 0 {
		start += n
	}
	if stop < 0 {
		stop += n
	}
	if start < 0 {
		start = 0
	}
	if stop >= n {
		stop = n - 1
	}
	if start >= n || stop < start {
		return []lapi.ScorePair{}
	}
	return pairs[start : stop+1]
}

func (c *ctx) makeFileDirectory(auth, path string) error {
	parent, name := splitFilePath(strings.TrimPrefix(path, "/"))
	if parent != "" {
		if err := c.makeFileDirectory(auth, "/"+parent); err != nil {
			return err
		}
	}
	entries, err := c.api.FilesLs(auth, "/"+parent)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name == name {
			if !entry.IsDir() {
				return fmt.Errorf("%s is not a directory", path)
			}
			return nil
		}
	}
	return c.api.FilesMkdir(auth, path, false)
}

func (c *ctx) commitFile(f *fileStore) error {
	if !f.writable {
		return fmt.Errorf("cannot commit a read-only File object")
	}
	if err := c.makeFileDirectory(f.auth, fileWorkRoot); err != nil {
		return err
	}
	// Leither's Files tree is also what retains the flushed DAG locally. Keep
	// one stable tree per MiMei; deleting the only staging tree after MFSetCid
	// leaves "last" pointing at a CID whose files are no longer available.
	pin := fileWorkRoot + "/" + fileSegment(f.mid)
	if f.root == "" {
		if _, err := c.api.FilesStat(f.auth, pin); err == nil {
			return fmt.Errorf("unexpected Files tree for new File object %s", f.mid)
		}
	} else if _, err := c.api.FilesStat(f.auth, pin); err != nil {
		// A previous commit may have advanced the MiMei before promoting its
		// scratch tree. Reattach that committed root; if its DAG is unavailable,
		// FilesCopy returns the real storage error rather than creating emptiness.
		if err := c.api.FilesCopy(f.auth, f.root, pin, false); err != nil {
			return fmt.Errorf("restore retained tree for %s: %v", f.mid, err)
		}
	}
	// Native handles are unique per open. Encode them before using them as paths.
	f.stage = fileWorkRoot + "/" + fileSegment(f.mid+"-"+f.handle+"-"+toString(time.Now().UnixNano()))
	if f.root == "" {
		if err := c.api.FilesMkdir(f.auth, f.stage, false); err != nil {
			return err
		}
	} else if err := c.api.FilesCopy(f.auth, f.root, f.stage, false); err != nil {
		return err
	}
	removeScratch := true
	defer func() {
		if removeScratch {
			if err := c.api.FilesRm(f.auth, f.stage, true, false); err != nil {
				c.warnf("remove staging tree: %v", err)
			}
		}
		f.stage = ""
	}()
	paths := []string{}
	for path := range f.changes {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		value := f.changes[path]
		parent, name := splitFilePath(path)
		entries, err := c.fileDirectory(f, parent)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Name == name {
				if err := c.api.FilesRm(f.auth, f.stage+"/"+path, false, false); err != nil {
					return err
				}
				break
			}
		}
		if value == nil {
			continue
		}
		if parent != "" {
			if err := c.makeFileDirectory(f.auth, f.stage+"/"+parent); err != nil {
				return err
			}
		}
		payload := []byte(jsonStringify(value))
		h, err := c.api.MFOpenTempFile(f.auth)
		if err != nil {
			return err
		}
		written, writeErr := c.api.MFSetData(h, payload, 0)
		if writeErr == nil && written != len(payload) {
			writeErr = fmt.Errorf("short File write: %s", path)
		}
		if writeErr == nil {
			writeErr = c.api.MFTruncate(h, int64(len(payload)))
		}
		if writeErr == nil {
			_, writeErr = c.api.MFTemp2Files(h, f.stage+"/"+path)
		}
		c.api.MMClose(h)
		if writeErr != nil {
			return writeErr
		}
	}
	cid, err := c.api.FilesFlush(f.auth, f.stage)
	if err != nil {
		return err
	}
	// MFSetCid creates the committed version itself. MMBackup here would
	// overwrite its directory CID with the MiMei's unrelated cur byte content.
	if _, err := c.api.MFSetCid(f.auth, f.mid, cid); err != nil {
		return err
	}
	if _, err := c.api.FilesStat(f.auth, pin); err == nil {
		if err := c.api.FilesRm(f.auth, pin, true, false); err != nil {
			// The scratch tree still retains the newly committed DAG.
			removeScratch = false
			return fmt.Errorf("replace retained tree for %s: %v", f.mid, err)
		}
	}
	if err := c.api.FilesCopy(f.auth, f.stage, pin, false); err != nil {
		// Keep scratch on this rare partial failure: MFSetCid already committed
		// its CID, so deleting scratch would make the new version unreadable.
		removeScratch = false
		return fmt.Errorf("retain committed tree for %s: %v", f.mid, err)
	}
	f.root, f.changes, f.dirs = "mm://"+f.mid+":"+verLast, map[string]map[string]any{}, map[string][]lapi.LsLink{}
	return nil
}
