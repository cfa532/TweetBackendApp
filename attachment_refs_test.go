package lapp

import (
	"io"
	"reflect"
	"sort"
	"testing"

	"Leither/lapi"
)

type attachmentRefAPI struct {
	lapi.LApi
	calls []string
}

func (a *attachmentRefAPI) MMAddRef(sid, mid string, children ...string) (int, error) {
	for _, child := range children {
		a.calls = append(a.calls, "ref:"+child)
	}
	return len(children), nil
}

func (a *attachmentRefAPI) MMDelRef(sid, mid string, children ...string) (int, error) {
	for _, child := range children {
		a.calls = append(a.calls, "unref:"+child)
	}
	return len(children), nil
}

// Editing a tweet's attachments moves its references for previews exactly as for
// the media they preview: a kept image keeps both, a dropped one releases both.
func TestReconcileAttachmentsMovesPreviewReferences(t *testing.T) {
	api := &attachmentRefAPI{}
	c := newCtx(api, "update_tweet", nil, nil, io.Discard)
	tweet := tweetObj{"attachments": []any{
		map[string]any{"mid": "kept", "previewMid": "kept-preview"},
		map[string]any{"mid": "dropped", "previewMid": "dropped-preview"},
	}}
	next := []any{
		map[string]any{"mid": "kept", "previewMid": "kept-preview"},
		map[string]any{"mid": "added", "previewMid": "added-preview"},
		map[string]any{"mid": "small"}, // under the preview threshold: no preview
	}
	if err := c.reconcileAttachments("author-session", "tweet", tweet, next); err != nil {
		t.Fatal(err)
	}
	sort.Strings(api.calls)
	want := []string{"ref:added", "ref:added-preview", "ref:small", "unref:dropped", "unref:dropped-preview"}
	if !reflect.DeepEqual(api.calls, want) {
		t.Fatalf("calls=%v, want %v", api.calls, want)
	}
}
