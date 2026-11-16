package lapp

import (
	"strings"
	"testing"
)

// message_outgoing on the sender's root stores the sender's copy and delivers
// the recipient's copy through the guarded peer path; a refused or unreachable
// recipient fails the whole send, because the recipient's copy is the delivery.
func TestMessageOutgoingDeliversThroughPeer(t *testing.T) {
	api := newCommentAPI("nodeA")
	api.addUser("sender", "nodeA", "uid-sender")
	api.addUser("receipt", "nodeB", "uid-receipt")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.reply = map[string]any{"success": true}

	params := map[string]string{
		"userid":    "sender",
		"receiptid": "receipt",
		"requestid": "same-send",
		"msg":       `{"content":"hi","authorId":"sender","receiptId":"receipt"}`,
	}
	ret, err := entryMessageOutgoing(commentCtx(api, "message_outgoing", params))
	if err != nil {
		t.Fatalf("message_outgoing returned error: %v", err)
	}
	if m, ok := toMap(ret); !ok || !mapBool(m, "success") {
		t.Fatalf("send failed: %#v", ret)
	}
	if api.remote == nil || api.remote.entry != "message_incoming" {
		t.Fatalf("no delivery delegation: %#v", api.remote)
	}
	req := api.remote.req
	if req["senderid"] != "sender" || req["receiptid"] != "receipt" || req["sid"] != "author-session" || req["requestid"] != "same-send" {
		t.Fatalf("delivery params wrong: %#v", req)
	}
	if !hasCall(api, "zadd:receipt") || !hasCall(api, "hset:mid-") || !strings.Contains(strings.Join(api.calls, " "), "/receipt/") {
		t.Fatalf("sender's copy not stored, calls: %v", api.calls)
	}
	if len(filterCalls(api, "stamped:")) != 1 {
		t.Fatalf("stored copies do not carry the delivery stamp, calls: %v", api.calls)
	}

	api.calls = nil
	ret, err = entryMessageOutgoing(commentCtx(api, "message_outgoing", params))
	if m, ok := toMap(ret); err != nil || !ok || !mapBool(m, "success") {
		t.Fatalf("retry failed: reply=%#v, error=%v", ret, err)
	}
	if hasCall(api, "zadd:") || len(filterCalls(api, "stamped:")) != 0 {
		t.Fatalf("retry wrote a duplicate sender copy: %v", api.calls)
	}

	// A peer refusal fails the send rather than leaving it half-delivered,
	// and nothing is written to the sender's store.
	api.remote = nil
	api.calls = nil
	api.reply = map[string]any{"success": false, "message": "Not called from a peer node"}
	ret, _ = entryMessageOutgoing(commentCtx(api, "message_outgoing", map[string]string{
		"userid":    "sender",
		"receiptid": "receipt",
		"msg":       `{"content":"hi","authorId":"sender","receiptId":"receipt"}`,
	}))
	if m, ok := toMap(ret); !ok || mapBool(m, "success") {
		t.Fatalf("refused delivery still reported success: %#v", ret)
	}
	if hasCall(api, "zadd:") || hasCall(api, "hset:") || hasCall(api, "backup:") {
		t.Fatalf("a refused send left a copy in the sender's store, calls: %v", api.calls)
	}
}

// message_incoming is peer-only: a bare client call never writes into the
// recipient's store; the sender's root passes the guard, and an unknown sender
// is pulled once so their root can be resolved.
func TestMessageIncomingPeerGuard(t *testing.T) {
	api := newCommentAPI("nodeB")
	api.addUser("receipt", "nodeB", "uid-receipt")
	api.addUser("sender", "nodeA", "uid-sender")
	api.authorSid, api.authorUID = "author-session", "uid-author"
	api.sessions["author-session"] = "uid-author"
	api.absent["sender"] = true
	api.codes["code-node"] = map[string]string{"nodeid": "nodeA", "forapp": "aid-test"}

	params := map[string]string{
		"senderid":    "sender",
		"receiptid":   "receipt",
		"nodeappcode": "code-node",
		"requestid":   "same-send",
		"msg":         `{"content":"hi","authorId":"sender","receiptId":"receipt"}`,
	}
	ret, err := entryMessageIncoming(commentCtx(api, "message_incoming", params))
	if err != nil {
		t.Fatalf("returned error: %v", err)
	}
	if m, ok := toMap(ret); !ok || !mapBool(m, "success") {
		t.Fatalf("guarded delivery failed: %#v", ret)
	}
	if !hasCall(api, "sync:sender") {
		t.Fatalf("absent sender not pulled, calls: %v", api.calls)
	}
	if !strings.Contains(strings.Join(api.calls, " "), "/"+userLastIncomingMsg+"/sender") {
		t.Fatalf("incoming indicator not written, calls: %v", api.calls)
	}

	api.calls = nil
	ret, err = entryMessageIncoming(commentCtx(api, "message_incoming", params))
	if m, ok := toMap(ret); err != nil || !ok || !mapBool(m, "success") {
		t.Fatalf("retry failed: reply=%#v, error=%v", ret, err)
	}
	if hasCall(api, "zadd:") || len(filterCalls(api, "stamped:")) != 0 || hasCall(api, "/"+userLastIncomingMsg+"/") {
		t.Fatalf("retry stored a duplicate or changed the unread indicator: %v", api.calls)
	}

	api.calls = nil
	api.hashFields = map[string]bool{}
	ret, _ = entryMessageIncoming(commentCtx(api, "message_incoming", map[string]string{
		"senderid":  "sender",
		"receiptid": "receipt",
		"msg":       `{"content":"hi","authorId":"sender","receiptId":"receipt"}`,
	}))
	if m, ok := toMap(ret); ok && mapBool(m, "success") {
		t.Fatalf("bare client call wrote into the recipient's store: %#v", ret)
	}
	if ok, msg := replyMessage(t, ret); ok || msg != "Not called from a peer node" {
		t.Fatalf("bare call: reply %t / %s, want peer refusal", ok, msg)
	}
	if len(api.calls) != 0 {
		t.Fatalf("refused delivery still wrote: %v", api.calls)
	}

	// A code naming any other node is refused too.
	api.codes["code-wrong"] = map[string]string{"nodeid": "nodeZ", "forapp": "aid-test"}
	ret, _ = entryMessageIncoming(commentCtx(api, "message_incoming", map[string]string{
		"senderid":    "sender",
		"receiptid":   "receipt",
		"nodeappcode": "code-wrong",
		"msg":         `{"content":"hi","authorId":"sender","receiptId":"receipt"}`,
	}))
	if m, ok := toMap(ret); ok && mapBool(m, "success") {
		t.Fatalf("foreign node passed the guard: %#v", ret)
	}
}
