package lapp

import (
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"

	"Leither/lapi"
)

// Unexpected APIs (including MMBackup and permanent-tree FilesStat) fail via
// the embedded nil interface. Only the File commit's required APIs are supplied.
type fileCommitAPI struct {
	lapi.LApi
	t                   *testing.T
	stage               string
	working, committed  map[string]string
	buffer              string
	flushErr, commitErr error
	commits, cleanups   int
}

func (a *fileCommitAPI) FilesLs(sid, path string) ([]lapi.LsLink, error) {
	if path != "/" {
		a.t.Fatalf("unexpected directory listing: %s", path)
	}
	return []lapi.LsLink{{Name: strings.TrimPrefix(fileWorkRoot, "/"), Type: lapi.TDir}}, nil
}
func (a *fileCommitAPI) FilesCopy(sid, src, dst string, flush bool) error {
	if src != "mm://tweet:last" || !strings.HasPrefix(dst, fileWorkRoot+"/tweet-") {
		a.t.Fatalf("unexpected copy (permanent retention must not be used): %s -> %s", src, dst)
	}
	a.stage = dst
	a.working = map[string]string{"core.json": "old", "keep.json": "unchanged", "gone.json": "remove"}
	return nil
}
func (a *fileCommitAPI) FilesRm(sid, path string, recursive, flush bool) error {
	if path == a.stage {
		if !recursive {
			a.t.Fatal("scratch cleanup must be recursive")
		}
		a.cleanups++
		a.working = nil
		return nil
	}
	if !strings.HasPrefix(path, a.stage+"/") {
		a.t.Fatalf("removal outside scratch: %s", path)
	}
	delete(a.working, strings.TrimPrefix(path, a.stage+"/"))
	return nil
}
func (a *fileCommitAPI) MFOpenTempFile(string) (string, error) { return "temp", nil }
func (a *fileCommitAPI) MFSetData(h string, b []byte, offset int64) (int, error) {
	a.buffer = string(b)
	return len(b), nil
}
func (a *fileCommitAPI) MFTruncate(string, int64) error { return nil }
func (a *fileCommitAPI) MFTemp2Files(h, path string) (string, error) {
	a.working[strings.TrimPrefix(path, a.stage+"/")] = a.buffer
	return "file-cid", nil
}
func (a *fileCommitAPI) MMClose(string) error { return nil }
func (a *fileCommitAPI) FilesFlush(sid, path string) (string, error) {
	if path != a.stage {
		a.t.Fatalf("flush outside scratch: %s", path)
	}
	return "committed-cid", a.flushErr
}
func (a *fileCommitAPI) MFSetCid(sid, mid, cid string) (string, error) {
	a.commits++
	if sid != "author" || mid != "tweet" || cid != "committed-cid" {
		a.t.Fatal("incorrect commit identity or CID")
	}
	if a.commitErr != nil {
		return "", a.commitErr
	}
	a.committed = map[string]string{}
	for k, v := range a.working {
		a.committed[k] = v
	}
	return "2", nil
}

func TestFileCommitWithoutPermanentRetention(t *testing.T) {
	for _, failure := range []string{"", "flush", "commit"} {
		t.Run("failure="+failure, func(t *testing.T) {
			api := &fileCommitAPI{t: t}
			injected := errors.New("injected storage failure")
			if failure == "flush" {
				api.flushErr = injected
			}
			if failure == "commit" {
				api.commitErr = injected
			}
			c := newCtx(api, "", nil, nil, io.Discard)
			f := &fileStore{mid: "tweet", handle: "handle", auth: "author", writable: true, root: "mm://tweet:last",
				changes: map[string]map[string]any{"core.json": {"content": "new"}, "gone.json": nil},
				dirs:    map[string][]lapi.LsLink{"": {{Name: "core.json"}, {Name: "keep.json"}, {Name: "gone.json"}}}}
			err := c.commitFile(f)
			if failure == "" {
				if err != nil {
					t.Fatal(err)
				}
				want := map[string]string{"core.json": `{"content":"new"}`, "keep.json": "unchanged"}
				if !reflect.DeepEqual(api.committed, want) {
					t.Fatalf("committed %v, want %v", api.committed, want)
				}
				if len(f.changes) != 0 || len(f.dirs) != 0 {
					t.Fatal("successful commit retained pending state")
				}
			} else {
				if err != injected {
					t.Fatalf("got %v, want storage error", err)
				}
				if api.committed != nil || len(f.changes) != 2 {
					t.Fatal("failed commit changed committed/pending state")
				}
			}
			wantCommits := 1
			if failure == "flush" {
				wantCommits = 0
			}
			if api.commits != wantCommits || api.cleanups != 1 || f.stage != "" {
				t.Fatalf("commits=%d cleanups=%d stage=%q", api.commits, api.cleanups, f.stage)
			}
		})
	}
}
