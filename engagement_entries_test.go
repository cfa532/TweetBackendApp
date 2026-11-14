package lapp

import (
	"strings"
	"testing"
)

// These tests share the comment fixture (commentAPI): database objects, an
// in-memory hash-field set for the engagement lists, and a canned cross-node
// hop. The write APIs are recorded rather than emulated.

func (a *commentAPI) Hset(mmsid, key, field string, value any) (int64, error) {
	id := strings.TrimPrefix(mmsid, "open:") + "/" + key + "/" + field
	a.calls = append(a.calls, "hset:"+id)
	a.hashFields[id] = true
	return 1, nil
}

// The store tests hash membership through Hget (a missing field reads nil), so
// the mock answers from the same in-memory set Hset writes.
func (a *commentAPI) Hget(mmsid, key, field string) (any, error) {
	if a.hashFields[strings.TrimPrefix(mmsid, "open:")+"/"+key+"/"+field] {
		return "member", nil
	}
	return nil, nil
}

func (a *commentAPI) Hlen(mmsid, key string) (int64, error) { return 0, nil }

// toggle_favorite on the engaging user's own root delegates the tweet-side
// write to the author's node before anything is recorded locally.
func TestToggleFavoriteDelegatesToAuthorNode(t *testing.T) {
	api := newCommentAPI("nodeA")
	api.addUser("liker", "nodeA", "uid-liker")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.sessions["sid-liker"] = "uid-liker"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.reply = map[string]any{"success": true, "tweet": map[string]any{"mid": "parent", "favoriteCount": int64(1)}}

	ret, err := entryToggleFavorite(commentCtx(api, "toggle_favorite", map[string]string{
		"usersid":       "sid-liker",
		"appuserid":     "liker",
		"tweetid":       "parent",
		"authorid":      "pauthor",
		"isfavorite":    "true",
		"hostid":        "nodeB",
		"userhostid":    "nodeA",
	}))
	if err != nil {
		t.Fatalf("toggle_favorite returned error: %v", err)
	}
	m, ok := toMap(ret)
	if !ok || !mapBool(m, "success") {
		t.Fatalf("toggle_favorite failed: %#v", ret)
	}
	if api.remote == nil || api.remote.entry != "apply_favorite" {
		t.Fatalf("no delegation to apply_favorite: %#v", api.remote)
	}
	req := api.remote.req
	if req["userid"] != "liker" || req["wanted"] != "true" || req["sid"] != "author-session" {
		t.Fatalf("delegation params wrong: %#v", req)
	}
	if !hasCall(api, "hset:liker/"+userFavoriteList+"/parent") {
		t.Fatalf("user's own list not written, calls: %v", api.calls)
	}
}

// apply_favorite admits only the engaging user's root node, and only for a
// tweet that belongs to the named author.
func TestApplyFavoritePeerGuard(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("liker", "nodeA", "uid-liker")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.codes["code-node"] = map[string]string{"nodeid": "nodeA", "forapp": "aid-test"}
	api.codes["code-wrong"] = map[string]string{"nodeid": "nodeZ", "forapp": "aid-test"}

	req := func(tweetid, code string) map[string]string {
		return map[string]string{
			"tweetid":  tweetid,
			"authorid": "pauthor",
			"userid":   "liker",
			"wanted":   "true",
			"nodeappcode": code,
		}
	}

	ret, err := entryApplyFavorite(commentCtx(api, "apply_favorite", req("parent", "code-node")))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if m, ok := toMap(ret); !ok || !mapBool(m, "success") {
		t.Fatalf("guarded apply failed: %#v", ret)
	}
	if !hasCall(api, "hset:parent/"+tweetLikeList+"/liker") {
		t.Fatalf("tweet's like list not written, calls: %v", api.calls)
	}

	api.calls = nil
	ret, _ = entryApplyFavorite(commentCtx(api, "apply_favorite", req("parent", "code-wrong")))
	if m, ok := toMap(ret); ok && mapBool(m, "success") {
		t.Fatalf("foreign node passed the guard: %#v", ret)
	}
	if len(api.calls) != 0 {
		t.Fatalf("refused apply still wrote: %v", api.calls)
	}

	// A tweet belonging to someone else, named under this root author.
	api.tweets["foreign"] = map[string]any{"mid": "foreign", "authorId": "someone-else"}
	ret, _ = entryApplyFavorite(commentCtx(api, "apply_favorite", req("foreign", "code-node")))
	if m, ok := toMap(ret); ok && mapBool(m, "success") {
		t.Fatalf("foreign tweet accepted: %#v", ret)
	}

	// A bare client call, no session and no code.
	ret, _ = entryApplyFavorite(commentCtx(api, "apply_favorite", req("parent", "")))
	if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
		t.Fatalf("bare call: reply %t / %s, want peer refusal", ok, msg)
	}
}

// apply_retweet carries the same guard; the list it writes is keyed by the
// retweet id, valued by the retweeting user.
func TestApplyRetweetPeerGuard(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("liker", "nodeA", "uid-liker")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.codes["code-node"] = map[string]string{"nodeid": "nodeA", "forapp": "aid-test"}

	ret, err := entryApplyRetweet(commentCtx(api, "apply_retweet", map[string]string{
		"tweetid":      "parent",
		"authorid":     "pauthor",
		"userid":       "liker",
		"retweetid":    "rt-1",
		"wanted":       "true",
		"nodeappcode":  "code-node",
	}))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if m, ok := toMap(ret); !ok || !mapBool(m, "success") {
		t.Fatalf("guarded apply failed: %#v", ret)
	}
	if !hasCall(api, "hset:parent/"+tweetRetweetList+"/rt-1") {
		t.Fatalf("retweet list not written, calls: %v", api.calls)
	}

	api.calls = nil
	ret, _ = entryApplyRetweet(commentCtx(api, "apply_retweet", map[string]string{
		"tweetid": "parent", "authorid": "pauthor", "userid": "liker", "retweetid": "rt-1", "wanted": "true",
	}))
	if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
		t.Fatalf("bare call: reply %t / %s, want peer refusal", ok, msg)
	}
}

// toggle_follower admits only the follower's own root; a follower this node
// has never seen is pulled once.
func TestToggleFollowerPeerGuard(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("target", "nodeB", "uid-target")
	api.addUser("follower", "nodeA", "uid-follower")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.absent["follower"] = true
	api.codes["code-node"] = map[string]string{"nodeid": "nodeA", "forapp": "aid-test"}

	ret, err := entryToggleFollower(commentCtx(api, "toggle_follower", map[string]string{
		"userid":     "target",
		"otherid":    "follower",
		"isfollower": "true",
		"nodeappcode": "code-node",
	}))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if m, ok := toMap(ret); !ok || !mapBool(m, "success") {
		t.Fatalf("guarded toggle_follower failed: %#v", ret)
	}
	if !hasCall(api, "sync:follower") {
		t.Fatalf("absent follower not pulled, calls: %v", api.calls)
	}
	if !hasCall(api, "hset:target/"+userFollowersList+"/follower") {
		t.Fatalf("followers list not written, calls: %v", api.calls)
	}

	api.calls = nil
	ret, _ = entryToggleFollower(commentCtx(api, "toggle_follower", map[string]string{
		"userid": "target", "otherid": "follower", "isfollower": "false",
	}))
	if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
		t.Fatalf("bare call: reply %v / %s, want peer refusal", ok, msg)
	}
	if len(api.calls) != 0 {
		t.Fatalf("refused toggle_follower still wrote: %v", api.calls)
	}
}
