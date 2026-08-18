// Package lapp is the Tweet backend, a Leither MApp.
//
// It is the server side of the Tweet clients (Tweet-iOS, Tweet for Android and
// TweetWeb): a decentralised social application in which every user account,
// tweet and comment is a Mimei object living on the node that owns it.
//
// # Structure
//
// Leither loads a MApp as a single package with one exported function, RunMApp,
// and routes each request to it by entry name. This replaces the previous
// implementation, which was one JavaScript file per entry; the entry names, the
// request parameters and the response shapes are unchanged, so existing clients
// need no modification.
//
//	main.go       entry dispatch
//	runtime.go    per-call context, request parameters, logging
//	routing.go    the account check every write entry makes
//	store.go      Mimei database access
//	model.go      user and tweet objects
//	caps.go       node operations the Go API does not expose (see the file)
//	json.go       JSON codec
//	auth.go       agent and peer-node authorisation
//	*_entries.go  the entries themselves, grouped by area
//
// # Which node handles a request
//
// Clients choose the node they write to. An entry writes to whichever node it
// was called on and refuses only when the account named is unknown there; it
// does not inspect hostIds and forward a misdirected request onwards. The few
// remaining cross-node calls are listed in caps.go and exist because the
// operation genuinely spans two owners.
//
// # Interpreter constraints
//
// The node compiles this with its ixgo interpreter, which is not a full Go
// runtime. Two limits are verified on a live node and shape the code:
//
//   - Package initialisation does not happen. Neither init functions nor
//     package-level var initialisers run, so any package-level variable is its
//     zero value when a request arrives. There are none left in this package;
//     anything that looks like shared setup is a function instead
//     (entryTable, bookmarkKind, favoriteKind). Reintroducing a package-level
//     var will not fail to compile — it will silently be empty at runtime.
//
//   - The standard library is partial. unicode/utf16 is absent, which is why
//     json.go spells out surrogate handling. Only fmt, io, errors, strings,
//     strconv, sort and time are known to resolve.
//
// Check both with a real run before trusting a change:
//
//	./Leither lpki runapp --local ./twbe health -a gen8.key
//
// # Building
//
// The app is uploaded as source and compiled by the node's ixgo interpreter, so
// it cannot be run directly. Use the compiler for a syntax check only:
//
//	cd go && go build .
//
// See README.md for upload and release instructions.
package lapp

import (
	"fmt"
	"io"
	"sort"

	"Leither/lapi"
)

// RunMApp is the application's single entry point.
//
// Entry names the entry to run, Request carries its parameters (plus the node's
// own aid/ver/sid), args carries anything after "--" on the command line, and wr
// is the response writer for entries that stream their output.
//
// Returning a value lets the node serialise the reply; returning an error makes
// the call fail. Most entries report application-level failures as a value with
// success=false rather than as an error, because the clients treat a transport
// error and a rejected request differently.
func RunMApp(Entry string, Request map[string]string, args []any, wr io.Writer) (any, error) {
	api := lapi.GetLApi()
	if api == nil {
		return nil, fmt.Errorf("GetLApi returned nil: this app must run inside a Leither container")
	}
	// In container mode the node's routing layer consumes the entry name, so
	// Entry arrives empty and the real name is left in Request["entry"] — the
	// same value the caller put in the URL. Only --local passes it positionally.
	// Reading both is what lets one RunMApp serve HTTP and CLI alike; without
	// it, every container request resolves to the empty entry.
	entry := Entry
	if entry == "" {
		entry = Request[reqEntry]
	}

	c := newCtx(api, entry, Request, args, wr)

	handler, ok := lookupEntry(entry)
	if !ok {
		// The request keys are named because the usual cause is not a typo but
		// the entry never arriving: which parameters the node forwards differs
		// between container and local invocation.
		return nil, fmt.Errorf("unknown entry %q (request carried: %v)", entry, requestKeys(Request))
	}
	return handler(c)
}

// requestKeys lists the parameter names a request arrived with, sorted so the
// output is stable.
func requestKeys(request map[string]string) []string {
	keys := make([]string, 0, len(request))
	for k := range request {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// entryFunc is the signature every entry implements.
type entryFunc func(c *ctx) (any, error)

// entryTable maps an entry name to its implementation. The names are the file
// names of the JavaScript implementation this replaces and are part of the
// client-facing contract.
//
// This is a function rather than a package-level variable for two reasons. A
// composite literal would be an initialisation cycle, because the entries call
// one another through callEntry and so refer back to the table. And the node's
// interpreter does not run package init functions, so a table filled in init
// would still be empty when the first request arrived — which presents as
// every entry being unknown.
//
// It is rebuilt per lookup. That is a few dozen map inserts against entries
// that each do Mimei I/O, and it keeps the table free of shared mutable state.
func entryTable() map[string]entryFunc {
	return map[string]entryFunc{
		// Users and accounts
		"register":             entryRegister,
		"login":                entryLogin,
		"get_user":             entryGetUser,
		"get_user_core_data":   entryGetUserCoreData,
		"get_userid":           entryGetUserID,
		"get_user_meta":        entryGetUserMeta,
		"set_author_core_data": entrySetAuthorCoreData,
		"set_user_avatar":      entrySetUserAvatar,
		"delete_account":       entryDeleteAccount,
		"sync_user":            entrySyncUser,
		"resync_user":          entryResyncUser,
		"verify_agent_token":   entryVerifyAgentToken,

		// Tweets
		"add_tweet":            entryAddTweet,
		"get_tweet":            entryGetTweet,
		"delete_tweet":         entryDeleteTweet,
		"update_tweet":         entryUpdateTweet,
		"refresh_tweet":        entryRefreshTweet,
		"get_tweet_feed":       entryGetTweetFeed,
		"get_tweet_id_list":    entryGetTweetIDList,
		"get_tweets_by_user":   entryGetTweetsByUser,
		"toggle_tweet_privacy": entryToggleTweetPrivacy,
		"get_pinned_tweets":    entryGetPinnedTweets,
		"toggle_pinned_tweet":  entryTogglePinnedTweet,
		"retweet_added":        entryRetweetAdded,
		"retweet_removed":      entryRetweetRemoved,

		// Comments
		"add_comment":    entryAddComment,
		"get_comments":   entryGetComments,
		"delete_comment": entryDeleteComment,

		// Engagement
		"toggle_bookmark":         entryToggleBookmark,
		"toggle_bookmark_by_user": entryToggleBookmarkByUser,
		"toggle_favorite":         entryToggleFavorite,
		"toggle_favorite_by_user": entryToggleFavoriteByUser,

		// Social graph
		"toggle_following":                entryToggleFollowing,
		"toggle_followed":                 entryToggleFollowed,
		"toggle_follower":                 entryToggleFollower,
		"get_followers":                   entryGetFollowers,
		"get_followings":                  entryGetFollowings,
		"get_followers_sorted":            entryGetFollowersSorted,
		"get_followings_sorted":           entryGetFollowingsSorted,
		"update_following_tweets":         entryUpdateFollowingTweets,
		"block_user":                      entryBlockUser,
		"get_blocked_users":               entryGetBlockedUsers,
		"remove_blacklisted_relationship": entryRemoveBlacklistedRelationship,

		// Messaging
		"message_check":    entryMessageCheck,
		"message_fetch":    entryMessageFetch,
		"message_incoming": entryMessageIncoming,
		"message_outgoing": entryMessageOutgoing,

		// Nodes and providers
		"get_node_ip":              entryGetNodeIP,
		"get_node_ips":             entryGetNodeIPs,
		"get_provider_ip":          entryGetProviderIP,
		"get_provider_ips":         entryGetProviderIPs,
		"node_get_score":           entryNodeGetScore,
		"node_update_score":        entryNodeUpdateScore,
		"node_update_mid_by_score": entryNodeUpdateMidByScore,
		"mimei_provide":            entryMimeiProvide,

		// Files and sharing
		"upload_file":           entryUploadFile,
		"upload_ipfs":           entryUploadIpfs,
		"upload_package":        entryUploadPackage,
		"upload_compressed_hls": entryUploadCompressedHLS,
		"share_file":            entryShareFile,
		"get_shared_file":       entryGetSharedFile,
		"get_shared_file_ip":    entryGetSharedFileIP,
		"open_mac":              entryOpenMac,
		"open_temp_file":        entryOpenTempFile,

		// Upgrades and diagnostics
		"check_upgrade":    entryCheckUpgrade,
		"download_upgrade": entryDownloadUpgrade,
		"health":           entryHealth,
		"logging":          entryLogging,
	}
}

// lookupEntry finds an entry's implementation by name.
func lookupEntry(name string) (entryFunc, bool) {
	handler, ok := entryTable()[name]
	return handler, ok
}
