/**
 * Handle chunked upload of compressed HLS video files.
 * Receives 1MB chunks of a zip file, assembles them, and extracts to temp directory.
 */

((request, args) => {
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            // If result already has success/status field, ensure it's in v2 format
            if (result && typeof result === 'object' && ('success' in result || 'status' in result)) {
                if ('status' in result && !('success' in result)) {
                    return {success: true, ...result}
                }
                return result
            }
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error}
        }
        throw error
    }
    
    try {
        const fs = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');
        const os = require('os');
        
        // Get authentication
        let authSid = lapi.BELoginAsAuthor();
        
        // Get or create file system ID for storing the zip chunks
        let fsid = request["fsid"] ? request["fsid"] : lapi.MFOpenTempFile(authSid);
        
        // Check if this is the final chunk
        if (request["finished"] === "true") {
            // All chunks received, now extract the zip file
            return extractAndValidateHLS(authSid, fsid, request);
        }
        
        // Handle chunk upload
        let offset = parseInt(request["offset"], 10);
        let chunkData = new Uint8Array(args[0]); // 1MB chunk data
        
        // Validate chunk size (should be 1MB = 1048576 bytes, except possibly the last chunk)
        if (chunkData.length > 1048576) {
            throw new Error(`Chunk size ${chunkData.length} exceeds 1MB limit`);
        }
        
        // Store the chunk at the specified offset
        lapi.MFSetData(fsid, chunkData, offset);
        
        lapi.Debug("Tweed upload_compressed_hls: Received chunk at offset=%s, size=%s bytes", offset, chunkData.length);
        
        return wrapResponse({
            fsid: fsid,
            offset: offset + chunkData.length,
            status: "chunk_received"
        });
        
    } catch(e) {
        lapi.Error("Tweed Error upload_compressed_hls: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack");
        return wrapError(e);
    }
    
    /**
     * Extract the assembled zip file and validate HLS structure
     */
    function extractAndValidateHLS(authSid, fsid, request) {
        const fs = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');
        const os = require('os');
        
        try {
            // Create a temporary directory for extraction
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hls_extract_'));
            lapi.Debug("Tweed upload_compressed_hls: Extracting to temp directory=%s", tempDir);
            
            // Get the complete zip file data from the temp file
            const zipData = lapi.MFGetData(fsid, 0, -1); // Get all data
            const zipPath = path.join(tempDir, 'hls_archive.zip');
            
            // Write zip data to file
            fs.writeFileSync(zipPath, zipData);
            lapi.Debug("Tweed upload_compressed_hls: Zip file written to=%s", zipPath);
            
            // Extract the zip file
            try {
                // Use built-in unzip command (available on most systems)
                execSync(`unzip -o "${zipPath}" -d "${tempDir}"`, { 
                    stdio: 'pipe',
                    timeout: 30000 // 30 second timeout
                });
                lapi.Debug("Tweed upload_compressed_hls: Zip file extracted successfully");
            } catch (extractError) {
                // If unzip fails, try with node modules if available
                try {
                    const AdmZip = require('adm-zip');
                    const zip = new AdmZip(zipPath);
                    zip.extractAllTo(tempDir, true);
                    lapi.Debug("Tweed upload_compressed_hls: Zip file extracted using AdmZip");
                } catch (nodeZipError) {
                    lapi.Error("Tweed upload_compressed_hls: Failed to extract zip file: %s", extractError.message);
                    throw new Error(`Failed to extract zip file: ${extractError.message}`);
                }
            }
            
            // Remove the zip file
            fs.unlinkSync(zipPath);
            
            // Validate HLS structure
            const hlsValidation = validateHLSStructure(tempDir);
            if (!hlsValidation.valid) {
                // Cleanup temp directory on validation failure
                fs.rmSync(tempDir, { recursive: true, force: true });
                lapi.Error("Tweed upload_compressed_hls: Invalid HLS structure: %s", hlsValidation.error);
                throw new Error(`Invalid HLS structure: ${hlsValidation.error}`);
            }
            
            lapi.Debug("Tweed upload_compressed_hls: Valid HLS structure found with segmentCount=%s", hlsValidation.segmentCount);
            
            // Create a new fsid for the extracted HLS directory
            const hlsFsid = lapi.MFOpenTempFile(authSid);
            
            // Store the temp directory path in the file system (as metadata)
            const metadata = {
                tempDir: tempDir,
                segmentCount: hlsValidation.segmentCount,
                playlistFiles: hlsValidation.playlistFiles,
                extractedAt: new Date().toISOString()
            };
            
            lapi.MFSetData(hlsFsid, new TextEncoder().encode(JSON.stringify(metadata)), 0);
            
            // If referenceid is provided, link to parent
            if (request["referenceid"] !== undefined) {
                try {
                    lapi.MFTemp2Ipfs(hlsFsid, request["referenceid"]);
                } catch(e) {
                    lapi.Error("Tweed upload_compressed_hls: Failed to convert temp to IPFS: %s", e);
                }
            }
            
            return wrapResponse({
                fsid: hlsFsid,
                tempDir: tempDir,
                segmentCount: hlsValidation.segmentCount,
                playlistFiles: hlsValidation.playlistFiles,
                status: "extracted_and_validated"
            });
            
        } catch (error) {
            lapi.Error("Tweed upload_compressed_hls: Error extracting HLS: %s, stack=%s", error, error.stack || "no stack");
            throw error;
        }
    }
    
    /**
     * Validate that the extracted directory contains valid HLS video structure
     */
    function validateHLSStructure(dirPath) {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const files = fs.readdirSync(dirPath, { recursive: true });
            const playlistFiles = [];
            let segmentCount = 0;
            
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stat = fs.statSync(filePath);
                
                if (stat.isFile()) {
                    const ext = path.extname(file).toLowerCase();
                    
                    // Check for playlist files (.m3u8)
                    if (ext === '.m3u8') {
                        playlistFiles.push(file);
                        
                        // Validate playlist content
                        const content = fs.readFileSync(filePath, 'utf8');
                        if (!content.includes('#EXTM3U')) {
                            return {
                                valid: false,
                                error: `Invalid M3U8 playlist: ${file}`
                            };
                        }
                    }
                    // Check for video segments (.ts, .mp4, .webm)
                    else if (['.ts', '.mp4', '.webm'].includes(ext)) {
                        segmentCount++;
                    }
                }
            }
            
            // Basic validation - should have at least one playlist and some segments
            if (playlistFiles.length === 0) {
                return {
                    valid: false,
                    error: "No M3U8 playlist files found"
                };
            }
            
            if (segmentCount === 0) {
                return {
                    valid: false,
                    error: "No video segment files found"
                };
            }
            
            return {
                valid: true,
                playlistFiles: playlistFiles,
                segmentCount: segmentCount
            };
            
        } catch (error) {
            return {
                valid: false,
                error: `Failed to validate HLS structure: ${error.message}`
            };
        }
    }
    
})(request, args);
