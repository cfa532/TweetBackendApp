// model.go — the user, tweet and comment objects.
//
// These are kept as maps rather than structs on purpose. Clients write fields
// the backend never interprets (display preferences, media metadata, fields
// added by a newer client than the node is running), and the JavaScript
// implementation preserved them simply by reading an object, changing the parts
// it cared about, and writing it back. Decoding into a struct would silently
// drop everything not declared here, so the maps stay and the named accessors
// below supply the type safety where it matters.
package lapp

import "fmt"

// userObj is a user account, stored under ownerDataKey in the user's own Mimei.
// The mid of that Mimei is the user's id.
type userObj map[string]any

func (u userObj) mid() string      { return mapStr(u, "mid") }
func (u userObj) username() string { return mapStr(u, "username") }
func (u userObj) name() string     { return mapStr(u, "name") }
func (u userObj) profile() string  { return mapStr(u, "profile") }
func (u userObj) password() string { return mapStr(u, "password") }
func (u userObj) avatar() string   { return mapStr(u, "avatar") }

// hostIDs lists the nodes that hold this user. The first entry is the root
// node, the authoritative write location; later entries are access nodes
// serving a synchronised copy.
func (u userObj) hostIDs() []string { return mapStrArr(u, "hostIds") }

// hostID is the user's root node, or "" when unknown. Writes to a user or their
// tweets belong on this node.
func (u userObj) hostID() string {
	ids := u.hostIDs()
	if len(ids) == 0 {
		return ""
	}
	return ids[0]
}

// agentPublicKey is the Ed25519 key an AI agent signs requests with, base64
// encoded. Empty when the user has not enabled agent access.
func (u userObj) agentPublicKey() string { return mapStr(u, "agentPublicKey") }

// hasValidHost reports whether routing decisions can be made for this user.
func (u userObj) hasValidHost() bool { return u.hostID() != "" }

// stripPassword removes the credential before a user object leaves the node.
func (u userObj) stripPassword() userObj {
	delete(u, "password")
	return u
}

// tweetObj is a tweet, stored under tweetContentKey in its own Mimei. A comment
// is the same object shape; what differs is where it lives, which is its parent
// author's node rather than its own author's node.
type tweetObj map[string]any

func (t tweetObj) mid() string      { return mapStr(t, "mid") }
func (t tweetObj) authorID() string { return mapStr(t, "authorId") }
func (t tweetObj) content() string  { return mapStr(t, "content") }

// timestamp is the creation time in milliseconds since the epoch.
func (t tweetObj) timestamp() int64 { return mapInt(t, "timestamp", 0) }

// originalTweetID is set on a retweet and names the tweet being quoted.
func (t tweetObj) originalTweetID() string { return mapStr(t, "originalTweetId") }

// originalAuthorID names the author of the quoted tweet.
func (t tweetObj) originalAuthorID() string { return mapStr(t, "originalAuthorId") }

// isPrivate reports whether the tweet is visible only to its author.
func (t tweetObj) isPrivate() bool { return mapBool(t, "isPrivate") }

// attachments lists the media objects referenced by the tweet. Each carries its
// own mid, which becomes a Mimei reference from the tweet.
func (t tweetObj) attachments() []map[string]any {
	raw := mapArr(t, "attachments")
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if m, ok := toMap(item); ok {
			out = append(out, m)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// loadUser reads a user object from whichever copy this node holds. It returns
// (nil, nil) when the node has no copy, which callers treat as "look elsewhere"
// rather than as an error.
func (c *ctx) loadUser(userID string) (userObj, error) {
	if userID == "" {
		return nil, fmt.Errorf("loadUser: empty user id")
	}
	var user userObj
	err := c.readMimei("", userID, func(mmsid string) error {
		m, err := c.getObject(mmsid, ownerDataKey)
		if err != nil {
			return err
		}
		user = userObj(m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return user, nil
}

// loadTweet reads a tweet or comment object from this node's copy.
func (c *ctx) loadTweet(tweetID string) (tweetObj, error) {
	if tweetID == "" {
		return nil, fmt.Errorf("loadTweet: empty tweet id")
	}
	var tweet tweetObj
	err := c.readMimei("", tweetID, func(mmsid string) error {
		m, err := c.getObject(mmsid, tweetContentKey)
		if err != nil {
			return err
		}
		tweet = tweetObj(m)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return tweet, nil
}

// userHostID resolves a user's root node without keeping the whole object.
func (c *ctx) userHostID(userID string) (string, error) {
	user, err := c.loadUser(userID)
	if err != nil {
		return "", err
	}
	if user == nil {
		return "", fmt.Errorf("user %s not found", userID)
	}
	return user.hostID(), nil
}
