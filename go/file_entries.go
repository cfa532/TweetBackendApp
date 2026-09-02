// file_entries.go — uploads, attachments, file sharing and app upgrades.
//
// Large uploads arrive in chunks. The first call opens a temporary file and
// returns its handle; later calls write at an offset; the final call converts
// the assembled file into an IPFS object and returns its content id. Media is
// therefore addressed by content, and identical uploads collapse to one object.
//
// An uploaded object stays alive only while something references it. Attaching
// it — to a user for an avatar, to a tweet for media — is what keeps it from
// being collected.
package lapp

import "fmt"

// ---------------------------------------------------------------------------
// upload_ipfs
// ---------------------------------------------------------------------------

// entryUploadIpfs receives one chunk of an upload, or finishes one.
//
// While chunks are arriving it returns the temporary file handle to pass to the
// next call. On the final call it publishes the assembled file to IPFS and
// returns its content id.
//
// The chunk bytes travel in args rather than in the request, because request
// parameters are strings.
func entryUploadIpfs(c *ctx) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	fsid := c.str("fsid")
	if fsid == "" {
		fsid, err = c.api.MFOpenTempFile(authSid)
		if err != nil {
			return c.wrapErr(fmt.Errorf("MFOpenTempFile: %v", err)), nil
		}
	}

	if c.str("finished") == "true" {
		cid, err := c.api.MFTemp2Ipfs(fsid, "")
		if err != nil {
			return c.wrapErr(fmt.Errorf("MFTemp2Ipfs: %v", err)), nil
		}
		// A reference is given when the upload belongs to something that
		// already exists, such as a user's avatar. Tweet media has no reference
		// yet: the tweet does not exist until the upload completes, so
		// add_tweet attaches it afterwards.
		if referenceID := c.str("referenceid"); referenceID != "" {
			c.debugf("Adding %s as reference to mid=%s", cid, referenceID)
			if err := c.attachToParent(authSid, referenceID, cid); err != nil {
				return c.wrapErr(err), nil
			}
		}
		return c.wrapNotNull(cid, "Upload failed"), nil
	}

	offset := c.intParam("offset", 0)
	chunk, err := c.chunkArg()
	if err != nil {
		return c.wrapErr(err), nil
	}
	if _, err := c.api.MFSetData(fsid, chunk, offset); err != nil {
		return c.wrapErr(fmt.Errorf("MFSetData: %v", err)), nil
	}
	return c.wrapNotNull(fsid, "Upload failed"), nil
}

// attachToParent references an uploaded object from an existing object so it is
// retained.
func (c *ctx) attachToParent(authSid, parentID, cid string) error {
	sid, err := c.api.MMOpen(authSid, parentID, verCur)
	if err != nil {
		return fmt.Errorf("MMOpen(%s, cur): %v", parentID, err)
	}
	defer c.closeMimei(sid)

	if err := c.addRef(sid, parentID, cid); err != nil {
		return err
	}
	return c.backupDelRef(sid, parentID, "")
}

// chunkArg reads the upload chunk from the call arguments.
func (c *ctx) chunkArg() ([]byte, error) {
	if len(c.args) == 0 {
		return nil, fmt.Errorf("missing chunk data")
	}
	switch t := c.args[0].(type) {
	case []byte:
		return t, nil
	case string:
		return []byte(t), nil
	case []any:
		// A chunk that crossed a transport boundary arrives as a list of
		// numbers rather than as bytes.
		out := make([]byte, 0, len(t))
		for _, item := range t {
			n, ok := toInt64(item)
			if !ok {
				return nil, fmt.Errorf("invalid chunk data")
			}
			out = append(out, byte(n))
		}
		return out, nil
	default:
		return nil, fmt.Errorf("invalid chunk data type %T", c.args[0])
	}
}

// ---------------------------------------------------------------------------
// upload_compressed_hls
// ---------------------------------------------------------------------------

// maxUploadChunk bounds a single chunk, matching what the clients send.
const maxUploadChunk = 1048576

// entryUploadCompressedHLS receives a zipped HLS bundle in chunks.
//
// Only the chunk-collection half is implemented. The final step of the previous
// version unpacked the archive on the node's own filesystem, using Node's fs,
// os and child_process modules and an external unzip binary. None of that
// exists for a MApp: it runs inside the container with no host filesystem and
// no process execution, so there is nothing to port that step onto. Finishing
// an upload therefore reports the limitation rather than failing obscurely
// halfway through.
//
// See README.md for what a replacement would need.
func entryUploadCompressedHLS(c *ctx) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	fsid := c.str("fsid")
	if fsid == "" {
		fsid, err = c.api.MFOpenTempFile(authSid)
		if err != nil {
			return c.wrapErr(fmt.Errorf("MFOpenTempFile: %v", err)), nil
		}
	}

	if c.str("finished") == "true" {
		err := fmt.Errorf("HLS archive extraction is not available: it requires host filesystem " +
			"and archive-extraction facilities that a MApp does not have. The uploaded chunks are " +
			"assembled at fsid=" + fsid + " and can be finished with upload_ipfs instead")
		c.errorf("%v", err)
		return c.wrapErr(err), nil
	}

	offset := c.intParam("offset", 0)
	chunk, err := c.chunkArg()
	if err != nil {
		return c.wrapErr(err), nil
	}
	if len(chunk) > maxUploadChunk {
		return c.wrapErr(fmt.Errorf("Chunk size %d exceeds 1MB limit", len(chunk))), nil
	}
	if _, err := c.api.MFSetData(fsid, chunk, offset); err != nil {
		return c.wrapErr(fmt.Errorf("MFSetData: %v", err)), nil
	}
	c.debugf("Received chunk at offset=%d, size=%d bytes", offset, len(chunk))

	return c.wrap(map[string]any{
		"fsid":   fsid,
		"offset": offset + int64(len(chunk)),
		"status": "chunk_received",
	}), nil
}

// ---------------------------------------------------------------------------
// upload_file
// ---------------------------------------------------------------------------

// entryUploadFile attaches an already-uploaded IPFS object to a user, which is
// what keeps it from being collected.
func entryUploadFile(c *ctx) (any, error) {
	userID := c.str("userid")

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	sid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(sid)

	if err := c.addRef(sid, userID, c.str("cid")); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.backupDelRef(sid, userID, ""); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.mimeiPublish(authSid, userID); err != nil {
		c.warnf("publish %s failed: %v", userID, err)
	}
	c.debugf("Attached file to user mid=%s", userID)
	return c.wrap(map[string]any{"success": true}), nil
}

// ---------------------------------------------------------------------------
// open_temp_file / open_mac
// ---------------------------------------------------------------------------

// entryOpenTempFile opens a temporary file and returns its handle, which starts
// a chunked upload.
func entryOpenTempFile(c *ctx) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	fsid, err := c.api.MFOpenTempFile(authSid)
	if err != nil {
		return c.wrapErr(fmt.Errorf("MFOpenTempFile: %v", err)), nil
	}
	return c.wrapNotNull(fsid, "Failed to create temp file"), nil
}

// entryOpenMac reads a content-addressed file whole.
func entryOpenMac(c *ctx) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	fsid, err := c.api.MFOpenMacFile(authSid, "", c.str("mac"))
	if err != nil {
		return c.wrapErr(fmt.Errorf("MFOpenMacFile: %v", err)), nil
	}
	// A count of -1 reads to the end of the file.
	data, err := c.api.MFGetData(fsid, 0, -1)
	if err != nil {
		return c.wrapErr(fmt.Errorf("MFGetData: %v", err)), nil
	}
	return c.wrapNotNull(data, "File not found"), nil
}

// ---------------------------------------------------------------------------
// share_file
// ---------------------------------------------------------------------------

// entryShareFile publishes a file from the user's own machine.
//
// The file's contents are not uploaded. A Mimei is derived from its path and
// carries only metadata; a peer that wants the file fetches it from the sharing
// user's node. Deriving the id from the path makes sharing idempotent: sharing
// the same file twice returns the same id.
func entryShareFile(c *ctx) (any, error) {
	userID := c.str("userid")

	file, err := c.obj("file")
	if err != nil {
		return c.wrapErr(err), nil
	}

	// The share is recorded on the sharing user's own account.
	if err := c.requireRootNode(userID); err != nil {
		return c.wrapErr(err), nil
	}

	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	path := mapStr(file, "path")
	mid, err := c.contentID(authSid, path)
	if err != nil {
		return c.wrapErr(err), nil
	}

	userSid, err := c.api.MMOpen(authSid, userID, verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(userSid)

	// Already shared: the derived id is the answer, and re-registering it would
	// reset the download count.
	existing, err := c.hget(userSid, userShareMid, mid)
	if err != nil {
		return c.wrapErr(err), nil
	}
	if existing != nil {
		c.debugf("shared file already exists, sharedObj=%s", jsonStringify(existing))
		return c.wrapNotNull(mid, "File sharing failed"), nil
	}

	fsid, err := c.api.MMOpen(authSid, mid, verCur)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(fsid)

	if err := c.api.MFSetObject(fsid, map[string]any{
		"userId":      userID,
		"path":        path,
		"name":        file["name"],
		"size":        file["size"],
		"isDirectory": file["isDirectory"],
		"modified":    file["modified"],
	}); err != nil {
		return c.wrapErr(fmt.Errorf("MFSetObject: %v", err)), nil
	}
	if err := c.backupDelRef(fsid, mid, ""); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.mimeiPublish(authSid, mid); err != nil {
		c.warnf("publish %s failed: %v", mid, err)
	}
	c.debugf("shared file mid=%s, file=%s", mid, jsonStringify(file))

	if err := c.hset(userSid, userShareMid, mid, map[string]any{
		"downloadCount": 0,
		// No restriction: the file is visible to anyone who has the id.
		"authorizedFor": nil,
		// Days the share stays valid; 0 means it does not expire.
		"validTime": 0,
		"modified":  nowMillis(),
	}); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.backupDelRef(userSid, userID, ""); err != nil {
		return c.wrapErr(err), nil
	}
	if err := c.mimeiPublish(authSid, userID); err != nil {
		c.warnf("publish %s failed: %v", userID, err)
	}
	return c.wrapNotNull(mid, "File sharing failed"), nil
}

// ---------------------------------------------------------------------------
// get_shared_file / get_shared_file_ip
// ---------------------------------------------------------------------------

// entryGetSharedFile reads a shared file's metadata.
func entryGetSharedFile(c *ctx) (any, error) {
	mmsid, err := c.api.MMOpen("", c.str(reqMID), verLast)
	if err != nil {
		return c.wrapErr(err), nil
	}
	defer c.closeMimei(mmsid)

	file, err := c.api.MFGetObject(mmsid)
	if err != nil {
		return c.wrapErr(fmt.Errorf("MFGetObject: %v", err)), nil
	}
	return c.wrapNotNull(file, "File not found"), nil
}

// entryGetSharedFileIP returns the address to download a shared file from.
//
// Unlike get_provider_ip this keeps private addresses: a shared file often
// lives on a machine reachable only across the same LAN, and that is exactly
// the case worth serving.
func entryGetSharedFileIP(c *ctx) (any, error) {
	providers, err := c.providerAddresses(c.str(reqMID))
	if err != nil {
		return c.wrapErr(err), nil
	}
	if providers == nil {
		return nil, nil
	}

	best := ""
	var bestScore int64
	found := false
	for _, p := range providers {
		if !found || p.score < bestScore {
			best, bestScore, found = p.addr, p.score, true
		}
	}
	c.debugf("ip=%s", best)
	if best == "" {
		return c.wrapNotNull(nil, "Shared file IP not found"), nil
	}
	return c.wrapNotNull(best, "Shared file IP not found"), nil
}

// ---------------------------------------------------------------------------
// Application packages
// ---------------------------------------------------------------------------

// upgradePackageMark identifies the Mimei holding the installable package. The
// id derives from this mark, so every node and client agrees on it without
// being told.
const upgradePackageMark = "package upgrade download"

// upgradePackageID resolves the upgrade package's Mimei id.
func (c *ctx) upgradePackageID(authSid, suffix string) (string, error) {
	mid, err := c.api.MMCreate(authSid, c.appID(), appExt, upgradePackageMark+suffix,
		mimeiTypeFile, rightUserObject)
	if err != nil {
		return "", fmt.Errorf("MMCreate(package): %v", err)
	}
	return mid, nil
}

// entryUploadPackage registers an uploaded installer under the well-known
// package id, so clients checking for upgrades find the new build.
func entryUploadPackage(c *ctx) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	suffix := ""
	if mini := c.str("mini"); mini != "" {
		suffix = "_" + mini
	}
	mid, err := c.upgradePackageID(authSid, suffix)
	if err != nil {
		return c.wrapErr(err), nil
	}
	c.debugf("Setting package CID %s to %s", c.str("cid"), mid)

	if _, err := c.api.MFSetCid(authSid, mid, c.str("cid")); err != nil {
		c.errorf("Failed to publish package %s: %v", mid, err)
		return c.wrapErr(fmt.Errorf("MFSetCid: %v", err)), nil
	}
	if err := c.mimeiPublish(authSid, mid); err != nil {
		c.errorf("Failed to publish package %s: %v", mid, err)
		return c.wrapErr(err), nil
	}
	c.debugf("mid=%s", mid)
	return c.wrapNotNull(mid, "Failed to create package"), nil
}

// Upgrade advertisement. These describe the build clients should be running and
// are edited by hand when a release ships.
const (
	// upgradeVersion must exceed the version the clients report, or they will
	// not offer the upgrade. It is kept in step with check_upgrade.js.
	upgradeVersion = 73
	// upgradeMission is how insistent the prompt is: minor, major or critical.
	upgradeMission = "minor"
	// upgradeDomain is the base host used for deep links and sharing.
	upgradeDomain = "t1.w333w.site"
)

// entryCheckUpgrade tells a client whether a newer build exists and where to
// get it.
func entryCheckUpgrade(c *ctx) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	mid, err := c.upgradePackageID(authSid, "")
	if err != nil {
		return c.wrapErr(err), nil
	}
	ret := map[string]any{
		"version":   upgradeVersion,
		"packageId": mid,
		"mission":   upgradeMission,
		"domain":    upgradeDomain,
	}
	c.debugf("%s", jsonStringify(ret))
	return c.wrapPassthrough(ret), nil
}

// entryDownloadUpgrade returns the installer's Mimei id for the client to
// fetch.
func entryDownloadUpgrade(c *ctx) (any, error) {
	authSid, err := c.authSid()
	if err != nil {
		return c.wrapErr(err), nil
	}
	mid, err := c.upgradePackageID(authSid, "")
	if err != nil {
		return c.wrapErr(err), nil
	}
	c.debugf("Upgrade package mid=%s", mid)
	return c.wrapNotNull(mid, "Failed to get upgrade package ID"), nil
}
