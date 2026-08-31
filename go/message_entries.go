// message_entries.go — direct messages.
//
// Each user has a message Mimei of their own, derived deterministically from
// their id so any node can address it without a lookup. Inside it, one sorted
// set and one hash per correspondent:
//
//	Zset  <otherUserId>              server timestamp -> same timestamp as member
//	Hash  <otherUserId>[timestamp]   the message itself
//
// Sending writes twice: the sender stores its own copy through message_outgoing,
// and message_incoming stores a copy on the recipient's node. Neither node needs
// the other to read its own history afterwards.
//
// Two indicators drive the unread badge, both on the recipient's Mimei:
//
//	incoming_message_indicator  hash: sender -> newest message timestamp
//	read_message_indicator      zset: sender -> when this user last read them
//
// A sender whose newest message is later than the last read time has something
// unread. Timestamps are taken from the node, not the client, so a client with a
// wrong clock cannot make its messages permanently unread or permanently read.
package lapp

import "fmt"

// messageScanLimit bounds how many messages one fetch returns.
const messageScanLimit = 1000

// messageMimeiID derives a user's message Mimei. MMCreate is deterministic in
// its mark, so this returns the same id every time and creates it on first use.
func (c *ctx) messageMimeiID(authSid, userID string) (string, error) {
	mid, err := c.api.MMCreate(authSid, c.appID(), appExtMessage,
		userID+"_"+userMessageMimei, mimeiTypeDatabase, rightUserObject)
	if err != nil {
		return "", fmt.Errorf("MMCreate(message mimei): %v", err)
	}
	return mid, nil
}

// ---------------------------------------------------------------------------
// message_outgoing
// ---------------------------------------------------------------------------

// entryMessageOutgoing stores the sender's copy of a message.
func entryMessageOutgoing(c *ctx) (any, error) {
	senderID := c.str("userid")
	receiptID := c.str("receiptid")

	msg, err := c.obj("msg")
	if err != nil {
		return c.wrapErrBool(err), nil
	}

	// The sender's message store lives on their root node, so this must be that
	// node. The legacy reply to either rejection is a bare false; the log names
	// which one it was.
	if err := c.requireRootNode(senderID); err != nil {
		return false, nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrBool(err), nil
	}
	msgMid, err := c.messageMimeiID(authSid, senderID)
	if err != nil {
		return c.wrapErrBool(err), nil
	}
	msgSid, err := c.api.MMOpen(authSid, msgMid, verCur)
	if err != nil {
		return c.wrapErrBool(err), nil
	}
	defer c.closeMimei(msgSid)
	c.debugf("%s outgoing message to %s, msg=%s, msgMid=%s", senderID, receiptID, c.str("msg"), msgMid)

	// The node's clock supplies both the ordering score and the key the message
	// is stored under, so the two cannot disagree.
	stamp := nowMillis()
	member := toString(stamp)
	if err := c.zadd(msgSid, receiptID, stamp, member); err != nil {
		return c.wrapErrBool(err), nil
	}
	if err := c.hset(msgSid, receiptID, member, msg); err != nil {
		return c.wrapErrBool(err), nil
	}
	if err := c.backupDelRef(msgSid, msgMid, ""); err != nil {
		return c.wrapErrBool(err), nil
	}
	return c.wrapSent(true), nil
}

// wrapSent reports whether a message was stored.
func (c *ctx) wrapSent(result any) any {
	if !c.isV2() {
		return result
	}
	if b, ok := result.(bool); ok {
		return map[string]any{"success": b, "data": map[string]any{"sent": b}}
	}
	if m, ok := toMap(result); ok {
		if _, isEnvelope := m["success"]; isEnvelope {
			return m
		}
	}
	return respOK(result)
}

// ---------------------------------------------------------------------------
// message_incoming
// ---------------------------------------------------------------------------

// entryMessageIncoming stores the recipient's copy of a message and marks the
// sender as having something new.
func entryMessageIncoming(c *ctx) (any, error) {
	senderID := c.str("senderid")
	receiptID := c.str("receiptid")

	msg, err := c.obj("msg")
	if err != nil {
		return c.wrapErrString(err), nil
	}

	// The recipient's message store lives on their root node, so this must be
	// that node.
	if err := c.requireRootNode(receiptID); err != nil {
		return map[string]any{"success": false, "error": "User host not found"}, nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrString(err), nil
	}
	msgMid, err := c.messageMimeiID(authSid, receiptID)
	if err != nil {
		return c.wrapErrString(err), nil
	}
	msgSid, err := c.api.MMOpen(authSid, msgMid, verCur)
	if err != nil {
		return c.wrapErrString(err), nil
	}
	defer c.closeMimei(msgSid)

	// The receiving node stamps the message. The sender's clock is not trusted
	// for this, because the unread comparison depends on it.
	stamp := nowMillis()
	member := toString(stamp)

	if err := c.hset(msgSid, userLastIncomingMsg, senderID, member); err != nil {
		return c.wrapErrString(err), nil
	}
	c.debugf("%s to %s, msg=%s", senderID, receiptID, c.str("msg"))

	if err := c.zadd(msgSid, senderID, stamp, member); err != nil {
		return c.wrapErrString(err), nil
	}
	if err := c.hset(msgSid, senderID, member, msg); err != nil {
		return c.wrapErrString(err), nil
	}
	if err := c.backupDelRef(authSid, msgMid, ""); err != nil {
		return c.wrapErrString(err), nil
	}
	return c.wrapPassthrough(map[string]any{"success": true}), nil
}

// ---------------------------------------------------------------------------
// message_check
// ---------------------------------------------------------------------------

// entryMessageCheck reports the newest unread message from each correspondent,
// for notifications. It does not mark anything read; only message_fetch does.
func entryMessageCheck(c *ctx) (any, error) {
	userID := c.str("userid")

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrList(err), nil
	}
	msgMid, err := c.messageMimeiID(authSid, userID)
	if err != nil {
		return c.wrapErrList(err), nil
	}

	// Resolved to reject a request for a user this node does not know.
	if err := c.requireKnownUser(userID); err != nil {
		return c.wrapErrList(fmt.Errorf("User host not found")), nil
	}

	msgSid, err := c.api.MMOpen("", msgMid, verLast)
	if err != nil {
		return c.wrapErrList(err), nil
	}
	defer c.closeMimei(msgSid)

	senders, err := c.hkeys(msgSid, userLastIncomingMsg)
	if err != nil {
		return c.wrapErrList(err), nil
	}

	unread := []any{}
	for _, senderID := range senders {
		// A sender never read from has no entry in the read indicator, which
		// leaves the last-read time at zero so every message counts as unread.
		lastRead := int64(0)
		rank, err := c.zrank(msgSid, userLastFetchMsg, senderID)
		if err != nil {
			return c.wrapErrList(err), nil
		}
		if rank > -1 {
			lastRead, err = c.zscore(msgSid, userLastFetchMsg, senderID)
			if err != nil {
				return c.wrapErrList(err), nil
			}
		}

		newest, err := c.hget(msgSid, userLastIncomingMsg, senderID)
		if err != nil {
			return c.wrapErrList(err), nil
		}
		newestStamp, ok := toInt64(newest)
		if !ok || newestStamp <= lastRead {
			continue
		}
		message, err := c.hget(msgSid, senderID, toString(newest))
		if err != nil {
			return c.wrapErrList(err), nil
		}
		if message == nil {
			continue
		}
		c.debugf("NEW MESSAGE from %s at %d", senderID, newestStamp)
		unread = append(unread, message)
	}
	return c.wrapPassthrough(unread), nil
}

// ---------------------------------------------------------------------------
// message_fetch
// ---------------------------------------------------------------------------

// entryMessageFetch returns everything received from one correspondent since
// the last fetch, and marks that conversation read.
func entryMessageFetch(c *ctx) (any, error) {
	userID := c.str("userid")
	senderID := c.str("senderid")

	// Marking the conversation read writes to the user's message store, so this
	// must be their root node.
	if err := c.requireRootNode(userID); err != nil {
		return c.wrapErrList(fmt.Errorf("User not found or missing host")), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErrList(err), nil
	}
	msgMid, err := c.messageMimeiID(authSid, userID)
	if err != nil {
		return c.wrapErrList(err), nil
	}
	msgSid, err := c.api.MMOpen(authSid, msgMid, verCur)
	if err != nil {
		return c.wrapErrList(err), nil
	}
	defer c.closeMimei(msgSid)

	lastRead := int64(0)
	rank, err := c.zrank(msgSid, userLastFetchMsg, senderID)
	if err != nil {
		return c.wrapErrList(err), nil
	}
	if rank > -1 {
		lastRead, err = c.zscore(msgSid, userLastFetchMsg, senderID)
		if err != nil {
			return c.wrapErrList(err), nil
		}
	}

	// The window starts one past the last read time so a message stamped
	// exactly at that moment is not delivered twice.
	now := nowMillis()
	stamps, err := c.zrangebyscore(msgSid, senderID, lastRead+1, now, 0, messageScanLimit)
	if err != nil {
		return c.wrapErrList(err), nil
	}

	messages := []any{}
	for _, stamp := range stamps {
		// This conversation holds both sides; only the sender's half is keyed
		// under their id here.
		message, err := c.hget(msgSid, senderID, stamp.Member)
		if err != nil {
			return c.wrapErrList(err), nil
		}
		if message == nil {
			continue
		}
		c.debugf("userId=%s fetched message from senderId=%s", userID, senderID)
		messages = append(messages, message)
	}

	// Marking read uses the same instant that bounded the query, so a message
	// arriving mid-fetch stays unread rather than being skipped.
	if err := c.zadd(msgSid, userLastFetchMsg, now, senderID); err != nil {
		return c.wrapErrList(err), nil
	}
	if err := c.backupDelRef(authSid, msgMid, ""); err != nil {
		return c.wrapErrList(err), nil
	}
	return c.wrapPassthrough(messages), nil
}
