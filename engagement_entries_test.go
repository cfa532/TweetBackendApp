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
	a.hashValues[id] = value
	// Messages carry their delivery stamp inside the stored object; recording
	// it lets the message tests assert it made it in.
	if m, ok := value.(map[string]any); ok {
		if stamp, ok := m["stamp"].(string); ok && stamp != "" {
			a.calls = append(a.calls, "stamped:"+stamp)
		}
	}
	return 1, nil
}

// The store tests hash membership through Hget (a missing field reads nil), so
// the mock answers from the same in-memory set Hset writes.
func (a *commentAPI) Hget(mmsid, key, field string) (any, error) {
	id := strings.TrimPrefix(mmsid, "open:") + "/" + key + "/" + field
	if !a.hashFields[id] {
		return nil, nil
	}
	if value, ok := a.hashValues[id]; ok {
		return value, nil
	}
	return "member", nil
}

func (a *commentAPI) Hlen(mmsid, key string) (int64, error) { return 0, nil }

// toggle_favorite updates the user's list and delegates the tweet-side write
// to the author's node.
func TestToggleFavoriteDelegatesToAuthorNode(t *testing.T) {
	api := newCommentAPI("nodeA")
	api.addUser("liker", "nodeA", "uid-liker")
	api.absent["pauthor"] = true
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.sessions["sid-liker"] = "uid-liker"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.reply = map[string]any{"success": true, "tweet": map[string]any{"mid": "parent", "favoriteCount": int64(1)}}

	c := commentCtx(api, "toggle_favorite", map[string]string{
		"usersid":    "sid-liker",
		"appuserid":  "liker",
		"tweetid":    "parent",
		"authorid":   "pauthor",
		"isfavorite": "true",
		"hostid":     "nodeB",
		"userhostid": "nodeA",
	})
	ret, err := entryToggleFavorite(c)
	if err != nil {
		t.Fatalf("toggle_favorite returned error: %v", err)
	}
	m, ok := toMap(ret)
	if !ok || !mapBool(m, "success") {
		t.Fatalf("toggle_favorite failed: %#v", ret)
	}
	if user, ok := toMap(m["user"]); !ok || mapStr(user, "mid") != "liker" {
		t.Fatalf("toggle_favorite returned an invalid user record: %#v", m["user"])
	}
	if api.remote != nil || len(c.postCommit) != 1 || m["tweet"] != nil {
		t.Fatalf("favorite response waited for the peer update: %#v", ret)
	}
	c.finishPostCommit(c.postCommit)
	if api.remote == nil || api.remote.entry != "apply_favorite" {
		t.Fatalf("no delegation to apply_favorite: %#v", api.remote)
	}
	req := api.remote.req
	if req[reqNodeID] != "nodeB" || req["userid"] != "liker" || req["wanted"] != "true" || req["sid"] != "author-session" {
		t.Fatalf("delegation params wrong: %#v", req)
	}
	if !hasCall(api, "hset:liker/"+userFavoriteList+"/parent") {
		t.Fatalf("user's own list not written, calls: %v", api.calls)
	}
}

func TestSavedListCommitsWhenPeerFails(t *testing.T) {
	for _, kind := range []engagementKind{bookmarkKind(), favoriteKind()} {
		t.Run(kind.entry, func(t *testing.T) {
			api := newCommentAPI("nodeA")
			api.addUser("saver", "nodeA", "uid-saver")
			api.addUser("author", "nodeB", "uid-author")
			api.authorSid = "author-session"
			api.sessions["sid-saver"] = "uid-saver"
			api.reply = respFail("Peer refused the tweet update")

			for _, wanted := range []bool{true, false} {
				c := commentCtx(api, kind.entry, map[string]string{
					kind.userParam:  "saver",
					kind.stateParam: boolParam(wanted),
					"usersid":       "sid-saver",
					"tweetid":       "post",
					"authorid":      "author",
				})
				ret, err := c.toggleEngagement(kind)
				reply, _ := toMap(ret)
				user, _ := toMap(reply["user"])
				if err != nil || !mapBool(reply, "success") || mapStr(user, "mid") != "saver" || reply["tweet"] != nil {
					t.Fatalf("saved-list write did not succeed independently: reply=%#v, err=%v", ret, err)
				}
				if api.hashFields["saver/"+kind.userKey+"/post"] != wanted || !hasCall(api, "backup:saver") {
					t.Fatalf("saved list was not committed, calls: %v", api.calls)
				}
				api.remote = nil
				c.finishPostCommit(c.postCommit)
				if api.remote == nil || api.remote.entry != kind.peerEntry {
					t.Fatalf("the tweet-side update was not attempted")
				}
			}
		})
	}
}

func TestToggleBookmarkRemovesSavedTweetWithMissingAuthor(t *testing.T) {
	api := newCommentAPI("nodeA")
	api.addUser("saver", "nodeA", "uid-saver")
	api.absent["deleted-author"] = true
	api.authorSid = "author-session"
	api.sessions["sid-saver"] = "uid-saver"
	bookmark := "saver/" + userBookmarkList + "/post"
	api.hashFields[bookmark] = true

	ret, err := entryToggleBookmark(commentCtx(api, "toggle_bookmark", map[string]string{
		"usersid":      "sid-saver",
		"userid":       "saver",
		"tweetid":      "post",
		"authorid":     "deleted-author",
		"isbookmarked": "false",
	}))
	reply, _ := toMap(ret)
	user, _ := toMap(reply["user"])
	if err != nil || !mapBool(reply, "success") || mapStr(user, "mid") != "saver" || reply["tweet"] != nil {
		t.Fatalf("bookmark removal did not succeed: reply=%#v, err=%v", ret, err)
	}
	if api.hashFields[bookmark] || !hasCall(api, "backup:saver") || api.remote != nil {
		t.Fatalf("expected a committed local removal, calls: %v, remote: %#v", api.calls, api.remote)
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
			"tweetid":     tweetid,
			"authorid":    "pauthor",
			"userid":      "liker",
			"wanted":      "true",
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
		"tweetid":     "parent",
		"authorid":    "pauthor",
		"userid":      "liker",
		"retweetid":   "rt-1",
		"wanted":      "true",
		"nodeappcode": "code-node",
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

func TestExplicitUnfollowCommitsWithoutPeerConfirmation(t *testing.T) {
	for _, host := range []string{"", "nodeB"} {
		t.Run("target-root="+host, func(t *testing.T) {
			api := newCommentAPI("nodeA")
			api.addUser("actor", "nodeA", "uid-actor")
			api.absent["target"] = true
			api.authorSid = "author-session"
			api.sessions["sid-actor"] = "uid-actor"
			api.reply = respFail("Target refused the follower update")
			relationship := "actor/" + userFollowingsList + "/target"
			api.hashFields[relationship] = true
			req := map[string]string{
				"version":            versionV2,
				"usersid":            "sid-actor",
				"userid":             "actor",
				"followingid":        "target",
				"followingid_hostid": host,
				"isfollowing":        "false",
			}
			for attempt := 0; attempt < 2; attempt++ {
				api.remote = nil
				ret, err := entryToggleFollowing(commentCtx(api, "toggle_following", req))
				reply, _ := toMap(ret)
				data, _ := toMap(reply["data"])
				if err != nil || !mapBool(reply, "success") || data["isFollowing"] != false || api.hashFields[relationship] {
					t.Fatalf("unfollow did not stay committed: %#v, err=%v", ret, err)
				}
				if attempt == 0 && host != "" {
					if api.remote == nil || api.remote.entry != "toggle_follower" || api.remote.req[reqNodeID] != host {
						t.Fatalf("unfollow did not use the supplied target root: %#v", api.remote)
					}
				} else if api.remote != nil {
					t.Fatalf("unexpected peer update: %#v", api.remote)
				}
			}
			if !hasCall(api, "backup:actor") {
				t.Fatalf("local relationship was not backed up: %v", api.calls)
			}
		})
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
		"userid":      "target",
		"otherid":     "follower",
		"isfollower":  "true",
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

// A retweet record belongs to the user it names: another user's node may
// neither clear it nor take it over, while its owner may clear it, and
// clearing a record that is not there stays a harmless repeat.
func TestApplyRetweetRecordBelongsToItsUser(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("liker", "nodeA", "uid-liker")
	api.addUser("other", "nodeA", "uid-other")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.codes["code-node"] = map[string]string{"nodeid": "nodeA", "forapp": "aid-test"}

	apply := func(userID, wanted string) (bool, string) {
		ret, err := entryApplyRetweet(commentCtx(api, "apply_retweet", map[string]string{
			"tweetid": "parent", "authorid": "pauthor", "userid": userID,
			"retweetid": "rt-1", "wanted": wanted, "nodeappcode": "code-node",
		}))
		if err != nil {
			t.Fatalf("returned error: %v", err)
		}
		m, _ := toMap(ret)
		return mapBool(m, "success"), mapStr(m, "message")
	}

	if ok, msg := apply("liker", "true"); !ok {
		t.Fatalf("owner's record refused: %s", msg)
	}
	for _, wanted := range []string{"false", "true"} {
		api.hdels = nil
		if ok, msg := apply("other", wanted); ok || msg != "This retweet record belongs to another user" {
			t.Fatalf("another user's request (wanted=%s): reply %t / %s, want refusal", wanted, ok, msg)
		}
		if len(api.hdels) != 0 {
			t.Fatalf("another user's request removed the record: %v", api.hdels)
		}
	}
	if ok, msg := apply("liker", "false"); !ok {
		t.Fatalf("owner could not clear their record: %s", msg)
	}
	if ok, msg := apply("other", "false"); !ok {
		t.Fatalf("clearing an absent record must stay harmless: %s", msg)
	}
}

// A caller with neither a session nor a node app code is refused before the
// acting user's account is looked for: resolving it can pull the account from
// the network, which a bare caller must not be able to set off.
func TestPeerGuardRefusesBareCallersBeforePulling(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.absent["stranger"] = true

	ret, err := entryApplyFavorite(commentCtx(api, "apply_favorite", map[string]string{
		"tweetid": "parent", "authorid": "pauthor", "userid": "stranger", "wanted": "true",
	}))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
		t.Fatalf("bare call: reply %t / %s, want peer refusal", ok, msg)
	}
	if hasCall(api, "sync:") {
		t.Fatalf("a bare caller set off an account pull: %v", api.calls)
	}
}

// The pre-delegation user-side halves let any caller edit any user's saved
// lists, and are gone.
func TestLegacyByUserEntriesAreRemoved(t *testing.T) {
	for _, name := range []string{"toggle_favorite_by_user", "toggle_bookmark_by_user"} {
		if _, ok := lookupEntry(name); ok {
			t.Fatalf("%s is still registered", name)
		}
	}
}
