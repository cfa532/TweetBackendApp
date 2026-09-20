package lapp

import (
	"errors"
	"io"
	"reflect"
	"testing"

	"Leither/lapi"
)

// This fixture is a File MiMei. It exposes no staging or backup APIs, so a
// regression that recommits the tweet before deletion fails immediately.
type fileDeleteAPI struct {
	lapi.LApi
	author       string
	unpublishErr error
	calls        []string
}

func (a *fileDeleteAPI) MMOpen(string, string, string, ...string) (string, error) {
	return "tweet-handle", nil
}
func (a *fileDeleteAPI) MMClose(string) error             { return nil }
func (a *fileDeleteAPI) BELoginAsAuthor() (string, error) { return "author-session", nil }
func (a *fileDeleteAPI) GetVar(sid, name string, args ...string) (any, error) {
	if name == "mminfo" {
		return map[string]any{"ext": fileExtPrefix + "tweet"}, nil
	}
	return []any{"last"}, nil
}
func (a *fileDeleteAPI) FilesStat(string, string) (*lapi.StatInfo, error) {
	return &lapi.StatInfo{Type: "directory", Hash: "root-cid"}, nil
}
func (a *fileDeleteAPI) FilesLs(string, string) ([]lapi.LsLink, error) {
	return []lapi.LsLink{{Name: "core.json"}}, nil
}
func (a *fileDeleteAPI) MMOpenUrl(string, string) (string, error) { return "core", nil }
func (a *fileDeleteAPI) MFGetSize(string) (int64, error) {
	data, _ := a.MFGetData("core", 0, -1)
	return int64(len(data)), nil
}
func (a *fileDeleteAPI) MFGetData(string, int64, int) ([]byte, error) {
	return []byte(jsonStringify(map[string]any{
		"schema": fileSchema, "kind": "tweet", "mid": "tweet",
		"value": map[string]any{
			"authorId": a.author, "content": "test", "originalTweetId": "original",
			"attachments": []any{map[string]any{"mid": "media"}},
		},
	})), nil
}
func (a *fileDeleteAPI) Debug(string, ...any) {}
func (a *fileDeleteAPI) MiMeiUnpublish(sid, dhts, mid string) ([]lapi.DhtReply, error) {
	a.calls = append(a.calls, "unpublish:"+mid)
	return nil, a.unpublishErr
}
func (a *fileDeleteAPI) MMDelVers(sid, mid string, versions ...string) (int64, error) {
	a.calls = append(a.calls, "versions:"+mid)
	return 2, nil
}
func (a *fileDeleteAPI) MMDelRef(sid, mid string, children ...string) (int, error) {
	for _, child := range children {
		a.calls = append(a.calls, "unref:"+mid+":"+child)
	}
	return len(children), nil
}

func TestDeleteFileTweetUnpublishesBeforeDeletionWithoutBackup(t *testing.T) {
	for _, mode := range []string{"success", "unpublish failure", "wrong author"} {
		t.Run(mode, func(t *testing.T) {
			a := &fileDeleteAPI{author: "user"}
			var want []string
			switch mode {
			case "success":
				want = []string{"unpublish:tweet", "unref:tweet:media", "versions:tweet", "unref:user:original", "unref:user:tweet"}
			case "unpublish failure":
				a.unpublishErr = errors.New("unpublish denied")
				want = []string{"unpublish:tweet"}
			case "wrong author":
				a.author = "someone-else"
			}
			c := newCtx(a, "delete_tweet", nil, nil, io.Discard)
			_, err := c.destroyTweet("author-session", "user", "tweet")
			if (err == nil) != (mode == "success") {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(a.calls, want) {
				t.Fatalf("calls=%v, want %v", a.calls, want)
			}
			if len(c.files) != 0 {
				t.Fatal("leaked File handle")
			}
		})
	}
}
