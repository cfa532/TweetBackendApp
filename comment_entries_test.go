package lapp

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"Leither/lapi"
)

// This fixture serves every object as a database MiMei: mminfo reports no
// extension, so openMimei hands back the raw handle and reads go through Get.
// The write APIs are recorded rather than emulated; the tests assert the
// decisions the comment entries make (who may call, where the write goes) and
// not Leither's own storage behaviour.
type commentAPI struct {
	lapi.LApi

	node      string
	users     map[string]map[string]any
	tweets    map[string]map[string]any
	sessions  map[string]string // sid -> Leither uid
	codes     map[string]map[string]string
	authorSid string
	authorUID string

	// absent simulates an account this node holds no copy of: reading it
	// fails the way MMOpen does on the real node ("ver is empty"), until
	// MiMeiSync pulls it (syncErr makes even the pull fail).
	absent   map[string]bool
	pulled   map[string]bool
	syncErr  error
	// hashFields is the in-memory hash state behind Hhas/Hset/Hdel.
	hashFields map[string]bool

	createErr error
	calls     []string
	hdels     []string
	remote    *remoteCall
	reply     any
}

type remoteCall struct {
	entry string
	req   map[string]string
}

func newCommentAPI(node string) *commentAPI {
	return &commentAPI{
		node:       node,
		users:      map[string]map[string]any{},
		tweets:     map[string]map[string]any{},
		sessions:   map[string]string{},
		codes:      map[string]map[string]string{},
		absent:     map[string]bool{},
		pulled:     map[string]bool{},
		hashFields: map[string]bool{},
	}
}

func (a *commentAPI) addUser(mid, host, authUID string) {
	a.users[mid] = map[string]any{"mid": mid, "hostIds": []string{host}, "authUid": authUID}
}

func (a *commentAPI) MMOpen(sid, mid, ver string, opt ...string) (string, error) {
	return "open:" + mid, nil
}
func (a *commentAPI) MMClose(string) error { return nil }
func (a *commentAPI) BELoginAsAuthor() (string, error) {
	return a.authorSid, nil
}
func (a *commentAPI) GetVar(sid, name string, args ...string) (any, error) {
	switch name {
	case "hostid":
		return a.node, nil
	case "userid":
		if uid, ok := a.sessions[sid]; ok {
			return uid, nil
		}
		return nil, fmt.Errorf("2:session id is not safe!")
	case "mminfo":
		return map[string]any{}, nil
	}
	return nil, nil
}

// SessionGet answers the node app code resolver: codes minted by this node
// carry their minter's nodeid and the app they were minted for.
func (a *commentAPI) SessionGet(sid, key string) (any, error) {
	if code, ok := a.codes[sid]; ok {
		return code[key], nil
	}
	return nil, fmt.Errorf("2:session id is not safe!")
}
func (a *commentAPI) Get(mmsid, key string) (any, error) {
	mid := strings.TrimPrefix(mmsid, "open:")
	if a.absent[mid] && !a.pulled[mid] {
		return nil, fmt.Errorf("MMOpen(%s, last): OpenMM ver is empty", mid)
	}
	if key == ownerDataKey {
		return a.users[mid], nil
	}
	if key == tweetContentKey {
		return a.tweets[mid], nil
	}
	return nil, nil
}

// MiMeiSync stands in for the network pull that brings an absent account
// onto this node.
func (a *commentAPI) MiMeiSync(sid, dhts, mid string, param map[string]string) error {
	if a.syncErr != nil {
		return a.syncErr
	}
	a.calls = append(a.calls, "sync:"+mid)
	a.pulled[mid] = true
	return nil
}
func (a *commentAPI) MMCreate(sid, appid, ext, mark string, tp byte, right uint64) (string, error) {
	if a.createErr != nil {
		return "", a.createErr
	}
	a.calls = append(a.calls, "create")
	return "new-object", nil
}
func (a *commentAPI) Hdel(mmsid, key string, fields ...string) (int64, error) {
	for _, field := range fields {
		a.hdels = append(a.hdels, mmsid+"/"+key+"/"+field)
		delete(a.hashFields, strings.TrimPrefix(mmsid, "open:")+"/"+key+"/"+field)
	}
	return int64(len(fields)), nil
}
func (a *commentAPI) Zrem(mmsid, key string, members ...string) (int64, error) {
	a.calls = append(a.calls, "zrem:"+key)
	return int64(len(members)), nil
}
func (a *commentAPI) Zcard(mmsid, key string) (int64, error) { return 3, nil }
func (a *commentAPI) MMAddRef(sid, mid string, fileids ...string) (int, error) {
	for _, child := range fileids {
		a.calls = append(a.calls, "addref:"+mid+":"+child)
	}
	return len(fileids), nil
}
func (a *commentAPI) MMDelRef(sid, mid string, children ...string) (int, error) {
	for _, child := range children {
		a.calls = append(a.calls, "delref:"+mid+":"+child)
	}
	return len(children), nil
}
func (a *commentAPI) MMDelVers(sid, mid string, vers ...string) (int64, error) {
	a.calls = append(a.calls, "delvers:"+mid)
	return 1, nil
}
func (a *commentAPI) MMBackup(sid, mid, memo string, opt ...string) (string, error) {
	a.calls = append(a.calls, "backup:"+mid)
	return "1", nil
}
func (a *commentAPI) MiMeiPublish(sid, dhts, mid string) ([]lapi.DhtReply, error) {
	return nil, nil
}
func (a *commentAPI) Trace(string, ...any) {}
func (a *commentAPI) Debug(string, ...any) {}
func (a *commentAPI) Info(string, ...any)  {}
func (a *commentAPI) Warn(string, ...any)  {}
func (a *commentAPI) Error(string, ...any) {}

// RunMApp stands in for the cross-node hop; a canned reply is returned.
func (a *commentAPI) RunMApp(entry string, req map[string]string, args []any, opts ...string) (any, error) {
	a.remote = &remoteCall{entry: entry, req: req}
	if a.reply == nil {
		return nil, errors.New("no canned reply")
	}
	return a.reply, nil
}

func commentCtx(api *commentAPI, entry string, req map[string]string) *ctx {
	if req == nil {
		req = map[string]string{}
	}
	req["aid"] = "aid-test"
	req["ver"] = "last"
	req["version"] = "v2"
	return newCtx(api, entry, req, nil, io.Discard)
}

func replyMessage(t *testing.T, ret any) (bool, string) {
	t.Helper()
	m, ok := toMap(ret)
	if !ok {
		t.Fatalf("reply is not an object: %#v", ret)
	}
	return mapBool(m, "success"), mapStr(m, "message")
}

func hasCall(a *commentAPI, prefix string) bool {
	for _, call := range a.calls {
		if strings.HasPrefix(call, prefix) {
			return true
		}
	}
	return false
}

// add_comment on the writer's root delegates the parent-side write to the
// parent author's node, carrying the author session the target verifies.
func TestAddCommentDelegatesToParentAuthorNode(t *testing.T) {
	api := newCommentAPI("nodeA")
	api.addUser("writer", "nodeA", "uid-writer")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.sessions["sid-writer"] = "uid-writer"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.reply = map[string]any{"success": true, "mid": "c1", "commentId": "c1", "count": int64(2)}

	ret, err := entryAddComment(commentCtx(api, "add_comment", map[string]string{
		"usersid":       "sid-writer",
		"tweetid":       "parent",
		"tweetauthorid": "pauthor",
		"comment":       `{"authorId":"writer","content":"hi"}`,
	}))
	if err != nil {
		t.Fatalf("add_comment returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); !ok {
		t.Fatalf("add_comment failed: %s", msg)
	}
	if api.remote == nil {
		t.Fatal("no cross-node call was made")
	}
	if api.remote.entry != "apply_comment" {
		t.Fatalf("delegated to %s, want apply_comment", api.remote.entry)
	}
	req := api.remote.req
	if req["tweetid"] != "parent" || req["tweetauthorid"] != "pauthor" {
		t.Fatalf("delegation params wrong: %#v", req)
	}
	if req["sid"] != "author-session" {
		t.Fatalf("delegation carried sid %q, want the author session", req["sid"])
	}
	forwarded, perr := jsonParseObject(req["comment"])
	if perr != nil || mapStr(forwarded, "authorId") != "writer" {
		t.Fatalf("forwarded comment wrong: %s", req["comment"])
	}
}

// The quote half of a quote-comment is created on the writer's node, best
// effort, and the quote fields never reach the parent author's node.
func TestAddCommentStripsQuoteFieldsWhenRetweetCreationFails(t *testing.T) {
	api := newCommentAPI("nodeA")
	api.addUser("writer", "nodeA", "uid-writer")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.sessions["sid-writer"] = "uid-writer"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.createErr = errors.New("no object creation on this node")
	api.reply = map[string]any{"success": true, "mid": "c1", "commentId": "c1", "count": int64(1)}

	ret, err := entryAddComment(commentCtx(api, "add_comment", map[string]string{
		"usersid":       "sid-writer",
		"tweetid":       "parent",
		"tweetauthorid": "pauthor",
		"comment":       `{"authorId":"writer","content":"hi","originalTweetId":"q","originalAuthorId":"pauthor"}`,
	}))
	if err != nil {
		t.Fatalf("add_comment returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); !ok {
		t.Fatalf("add_comment failed although the quote half is best effort: %s", msg)
	}
	forwarded, perr := jsonParseObject(api.remote.req["comment"])
	if perr != nil {
		t.Fatalf("forwarded comment is not JSON: %s", api.remote.req["comment"])
	}
	if _, has := forwarded["originalTweetId"]; has {
		t.Fatal("quote fields reached the parent author's node")
	}
}

// apply_comment is a peer entry: a request without the application author's
// session is refused before anything is written.
func TestApplyCommentRefusesClientCallers(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("writer", "nodeA", "uid-writer")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.sessions["sid-guest"] = "uid-guest"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}

	for name, sid := range map[string]string{"no session": "", "user session": "sid-guest"} {
		ret, err := entryApplyComment(commentCtx(api, "apply_comment", map[string]string{
			"sid":           sid,
			"tweetid":       "parent",
			"tweetauthorid": "pauthor",
			"comment":       `{"authorId":"writer","content":"hi"}`,
		}))
		if err != nil {
			t.Fatalf("%s: returned error: %v", name, err)
		}
		if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
			t.Fatalf("%s: reply %s / %s, want refusal", name, fmt.Sprint(ok), msg)
		}
	}
	if len(api.calls) != 0 {
		t.Fatalf("refused request still wrote: %v", api.calls)
	}
}

// The parent object must belong to the author the request names, and the
// request must be on that author's root node.
func TestApplyCommentChecksParentAuthor(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "someone-else"}

	ret, err := entryApplyComment(commentCtx(api, "apply_comment", map[string]string{
		"sid":           "author-session",
		"tweetid":       "parent",
		"tweetauthorid": "pauthor",
		"comment":       `{"authorId":"writer","content":"hi"}`,
	}))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); ok || !strings.Contains(msg, "does not belong to the named author") {
		t.Fatalf("reply %s / %s, want parent/author mismatch refusal", fmt.Sprint(ok), msg)
	}

	// The same request on a node that is not the parent author's root is
	// refused before the parent object is even read.
	api.node = "nodeA"
	ret, err = entryApplyComment(commentCtx(api, "apply_comment", map[string]string{
		"sid":           "author-session",
		"tweetid":       "parent",
		"tweetauthorid": "pauthor",
		"comment":       `{"authorId":"writer","content":"hi"}`,
	}))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); ok || !strings.Contains(msg, "not the root node") {
		t.Fatalf("reply %s / %s, want root-node refusal", fmt.Sprint(ok), msg)
	}
}

// Only the comment's author and the parent's author may delete; the authority
// check runs where the comment object lives.
func TestRemoveCommentAuthority(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("writer", "nodeA", "uid-writer")
	api.addUser("stranger", "nodeC", "uid-stranger")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.tweets["c1"] = map[string]any{"mid": "c1", "authorId": "writer"}

	base := func() map[string]string {
		return map[string]string{
			"sid":       "author-session",
			"author":    "uid-author",
			"tweetid":   "parent",
			"commentid": "c1",
		}
	}

	ret, err := entryRemoveComment(commentCtx(api, "remove_comment", withParam(base(), "appuserid", "writer")))
	if err != nil {
		t.Fatalf("comment author deletion returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); !ok {
		t.Fatalf("comment author deletion failed: %s", msg)
	}
	for _, want := range []string{"delvers:c1", "delref:parent:c1", "zrem:" + tweetCommentList, "backup:parent"} {
		if !hasCall(api, want) {
			t.Fatalf("deletion missing %s, calls: %v", want, api.calls)
		}
	}

	ret, _ = entryRemoveComment(commentCtx(api, "remove_comment", withParam(base(), "appuserid", "stranger")))
	if ok, msg := replyMessage(t, ret); ok || !strings.Contains(msg, "parent's author may delete") {
		t.Fatalf("third-party deletion: reply %s / %s, want refusal", fmt.Sprint(ok), msg)
	}

	// A comment that no longer resolves leaves its list entry in the parent
	// author's data; only the parent's author may clean that up.
	ret, _ = entryRemoveComment(commentCtx(api, "remove_comment", withParam(base(), "appuserid", "pauthor")))
	if ok, msg := replyMessage(t, ret); !ok {
		t.Fatalf("parent author cleanup failed: %s", msg)
	}
	api.tweets["c1"] = nil
	ret, _ = entryRemoveComment(commentCtx(api, "remove_comment", withParam(base(), "appuserid", "writer")))
	if ok, msg := replyMessage(t, ret); ok || msg != "Comment not found" {
		t.Fatalf("missing comment by non-owner: reply %s / %s, want Comment not found", fmt.Sprint(ok), msg)
	}
}

func withParam(params map[string]string, key, value string) map[string]string {
	params[key] = value
	return params
}

// A cross-node request arrives without sid (the forwarding node deletes it)
// and carries the platform-injected node app code. The code must name the
// delegating node — the comment writer's root; a code minted by anyone else,
// including an ordinary user, is refused before anything is written.
func TestApplyCommentCrossNodeNodeAppCode(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("writer", "nodeA", "uid-writer")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.createErr = errors.New("stop after the guard")
	api.codes = map[string]map[string]string{
		"code-node":  {"nodeid": "nodeA", "forapp": "aid-test"},
		"code-wrong": {"nodeid": "nodeZ", "forapp": "aid-test"},
		"code-user":  {"nodeid": "uid-guest", "forapp": "aid-test"},
		"code-app":   {"nodeid": "nodeA", "forapp": "another-app"},
	}

	req := func(code string) map[string]string {
		return map[string]string{
			"tweetid":       "parent",
			"tweetauthorid": "pauthor",
			"nodeappcode":   code,
			"comment":       `{"authorId":"writer","content":"hi"}`,
		}
	}

	// The genuine delegating node passes the guard and the entry proceeds
	// until this fixture refuses to create the object.
	ret, err := entryApplyComment(commentCtx(api, "apply_comment", req("code-node")))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); ok || !strings.Contains(msg, "stop after the guard") {
		t.Fatalf("reply %s / %s, want the guard passed and creation failed", fmt.Sprint(ok), msg)
	}

	for name, code := range map[string]string{
		"another node": "code-wrong",
		"a user":       "code-user",
		"another app":  "code-app",
		"unknown code": "code-missing",
	} {
		ret, err := entryApplyComment(commentCtx(api, "apply_comment", req(code)))
		if err != nil {
			t.Fatalf("%s: returned error: %v", name, err)
		}
		if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
			t.Fatalf("%s: reply %s / %s, want peer refusal", name, fmt.Sprint(ok), msg)
		}
	}
	if hasCall(api, "create") {
		t.Fatalf("refused requests still created an object: %v", api.calls)
	}
}

// A commenter whose account this node has never seen arrives as an MMOpen
// error, not an empty record; their account is pulled once so their root —
// and with it the expected delegating node — can be resolved.
func TestApplyCommentPullsUnknownCommentAuthor(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("writer", "nodeA", "uid-writer")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.codes["code-node"] = map[string]string{"nodeid": "nodeA", "forapp": "aid-test"}
	api.absent["writer"] = true
	api.createErr = errors.New("stop after the guard")

	ret, err := entryApplyComment(commentCtx(api, "apply_comment", map[string]string{
		"tweetid":       "parent",
		"tweetauthorid": "pauthor",
		"nodeappcode":   "code-node",
		"comment":       `{"authorId":"writer","content":"hi"}`,
	}))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if !hasCall(api, "sync:writer") {
		t.Fatalf("absent writer was not pulled, calls: %v", api.calls)
	}
	if ok, msg := replyMessage(t, ret); ok || !strings.Contains(msg, "stop after the guard") {
		t.Fatalf("reply %s / %s, want the guard passed and creation failed", fmt.Sprint(ok), msg)
	}

	// A writer whose account cannot be pulled is refused before the guard.
	api.pulled = map[string]bool{}
	api.syncErr = errors.New("no provider")
	ret, _ = entryApplyComment(commentCtx(api, "apply_comment", map[string]string{
		"tweetid":       "parent",
		"tweetauthorid": "pauthor",
		"nodeappcode":   "code-node",
		"comment":       `{"authorId":"writer","content":"hi"}`,
	}))
	if ok, msg := replyMessage(t, ret); ok || msg != "User writer is not known here" {
		t.Fatalf("reply %s / %s, want unknown-user refusal", fmt.Sprint(ok), msg)
	}
}

// The local-delegation branch: sid must resolve to the uid the node injected
// as the app record's author. A client cannot forge that key, and a session
// that is not the app author's does not pass.
func TestApplyCommentLocalSessionMustMatchAuthorKey(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("writer", "nodeA", "uid-writer")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.sessions["sid-guest"] = "uid-guest"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.createErr = errors.New("stop after the guard")

	base := func(sid, author string) map[string]string {
		return map[string]string{
			"sid":           sid,
			"author":        author,
			"tweetid":       "parent",
			"tweetauthorid": "pauthor",
			"comment":       `{"authorId":"writer","content":"hi"}`,
		}
	}

	for name, params := range map[string]map[string]string{
		"no author key":  base("author-session", ""),
		"foreign author": base("author-session", "uid-guest"),
		"user session":   base("sid-guest", "uid-author"),
	} {
		ret, err := entryApplyComment(commentCtx(api, "apply_comment", params))
		if err != nil {
			t.Fatalf("%s: returned error: %v", name, err)
		}
		if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
			t.Fatalf("%s: reply %s / %s, want peer refusal", name, fmt.Sprint(ok), msg)
		}
	}

	// The matching pair passes the guard and proceeds to creation, which this
	// fixture refuses.
	ret, err := entryApplyComment(commentCtx(api, "apply_comment", base("author-session", "uid-author")))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); ok || !strings.Contains(msg, "stop after the guard") {
		t.Fatalf("reply %s / %s, want the guard passed and creation failed", fmt.Sprint(ok), msg)
	}
}

// remove_comment admits the delegating node named by the injected code: the
// deleter's own root. A code naming any other node is refused before the
// comment is touched.
func TestRemoveCommentCrossNodeNodeAppCode(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("writer", "nodeA", "uid-writer")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.tweets["c1"] = map[string]any{"mid": "c1", "authorId": "writer"}
	api.codes = map[string]map[string]string{
		"code-node":  {"nodeid": "nodeA", "forapp": "aid-test"},
		"code-wrong": {"nodeid": "nodeZ", "forapp": "aid-test"},
	}

	req := func(code string) map[string]string {
		return map[string]string{
			"tweetid":     "parent",
			"commentid":   "c1",
			"appuserid":   "writer",
			"nodeappcode": code,
		}
	}

	ret, err := entryRemoveComment(commentCtx(api, "remove_comment", req("code-node")))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); !ok {
		t.Fatalf("delegated deletion failed: %s", msg)
	}
	if !hasCall(api, "delvers:c1") || !hasCall(api, "delref:parent:c1") {
		t.Fatalf("deletion missing steps, calls: %v", api.calls)
	}

	api.calls = nil
	ret, _ = entryRemoveComment(commentCtx(api, "remove_comment", req("code-wrong")))
	if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
		t.Fatalf("foreign node: reply %s / %s, want peer refusal", fmt.Sprint(ok), msg)
	}
	if len(api.calls) != 0 {
		t.Fatalf("refused deletion still wrote: %v", api.calls)
	}
}


// delete_comment runs on the deleter's root and delegates the parent-side
// removal to the parent author's node; a refusal there reaches the client
// unchanged and leaves the deleter's saved lists alone.
func TestDeleteCommentDelegatesFromDeletersRoot(t *testing.T) {
	api := newCommentAPI("nodeA")
	api.addUser("writer", "nodeA", "uid-writer")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.sessions["sid-writer"] = "uid-writer"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}

	req := func() map[string]string {
		return map[string]string{
			"usersid":   "sid-writer",
			"appuserid": "writer",
			"tweetid":   "parent",
			"commentid": "c1",
		}
	}

	api.reply = map[string]any{"success": true, "commentId": "c1", "count": int64(0)}
	ret, err := entryDeleteComment(commentCtx(api, "delete_comment", req()))
	if err != nil {
		t.Fatalf("delete_comment returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); !ok {
		t.Fatalf("delete_comment failed: %s", msg)
	}
	if api.remote == nil || api.remote.entry != "remove_comment" {
		t.Fatalf("no delegation to remove_comment: %#v", api.remote)
	}
	if api.remote.req["appuserid"] != "writer" || api.remote.req["sid"] != "author-session" {
		t.Fatalf("delegation params wrong: %#v", api.remote.req)
	}
	// The deleted comment left the deleter's saved lists on the deleter's node.
	for _, want := range []string{"open:writer/" + userBookmarkList + "/c1", "open:writer/" + userFavoriteList + "/c1"} {
		found := false
		for _, hdel := range api.hdels {
			if hdel == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("saved list %s not cleaned, hdels: %v", want, api.hdels)
		}
	}

	api.hdels = nil
	api.reply = map[string]any{"success": false, "message": "Only the comment's author or the parent's author may delete this comment"}
	ret, _ = entryDeleteComment(commentCtx(api, "delete_comment", req()))
	if ok, msg := replyMessage(t, ret); ok || !strings.Contains(msg, "parent's author may delete") {
		t.Fatalf("refused deletion: reply %s / %s, want the peer's refusal", fmt.Sprint(ok), msg)
	}
	if len(api.hdels) != 0 {
		t.Fatalf("refused deletion still touched saved lists: %v", api.hdels)
	}
}

// When the deleter's node is the parent author's, the whole deletion happens
// locally with no cross-node call.
func TestDeleteCommentByParentAuthorRunsLocally(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("pauthor", "nodeB", "uid-pauthor")
	api.addUser("writer", "nodeA", "uid-writer")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.sessions["sid-pauthor"] = "uid-pauthor"
	api.tweets["parent"] = map[string]any{"mid": "parent", "authorId": "pauthor"}
	api.tweets["c1"] = map[string]any{"mid": "c1", "authorId": "writer"}

	ret, err := entryDeleteComment(commentCtx(api, "delete_comment", map[string]string{
		"usersid":   "sid-pauthor",
		"appuserid": "pauthor",
		"tweetid":   "parent",
		"commentid": "c1",
	}))
	if err != nil {
		t.Fatalf("delete_comment returned error: %v", err)
	}
	if ok, msg := replyMessage(t, ret); !ok {
		t.Fatalf("delete_comment failed: %s", msg)
	}
	if api.remote != nil {
		t.Fatalf("local deletion made a cross-node call: %#v", api.remote)
	}
	if !hasCall(api, "delvers:c1") || !hasCall(api, "delref:parent:c1") {
		t.Fatalf("local deletion missing steps, calls: %v", api.calls)
	}
	found := false
	for _, hdel := range api.hdels {
		if hdel == "open:pauthor/"+userBookmarkList+"/c1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("parent author's saved list not cleaned, hdels: %v", api.hdels)
	}
}
