/**
 * Node Update Mid By Score Function
 * 
 * This function compares the score of a given mimei ID with its score on a remote host.
 * If the scores differ, it syncs the mimei from the remote host and updates the
 * score on the current node to ensure data consistency across the distributed network.
 * 
 * Key Features:
 * - Compares scores between local and remote nodes
 * - Syncs content when score discrepancies are found
 * - Updates local scores to match remote scores
 * - Ensures data consistency across distributed nodes
 * - Handles new mimei IDs that haven't been synced before
 * 
 * @param {Object} request - The request object containing score comparison data
 * @param {string} request.aid - Application ID
 * @param {string} request.hostid - Remote host ID to compare scores with
 * @param {string} request.userid - User ID associated with the mimei
 * @param {string} request.mid - Mimei ID to compare and update
 * @param {string} request.ver - Version identifier
 * @param {Array} args - Additional arguments (unused)
 */
((request, args) => {
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    // Extract request parameters
    const APP_ID = request["aid"]  // Application identifier
    const hostId = request["hostid"]  // Remote host ID to compare scores with
    const userId = request["userid"]  // User ID associated with the mimei
    const mid = request["mid"]  // Mimei ID to compare and update
    const nodeId = lapi.GetVar("", "hostid")  // Current node identifier
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            return {success: true, data: result}
        }
        return result
    }
    
    // Helper function to wrap error response in v2 format if needed
    function wrapError(error) {
        if (version === 'v2') {
            return {success: false, message: error.message || String(error), error: error}
        }
        return undefined
    }

    // Skip processing if we're already on the target host
    if (nodeId === hostId) {
        return wrapResponse({success: true, message: "Already on target host"})
    }

    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const systemSid = lapi.BEOpenAppDataNode("cur", APP_ID)  // Open application data node
        
        // ========================================================================
        // CHECK FOR EXISTING MIMEI
        // ========================================================================
        
        // Check if the mid exists in the sorted set
        const rank = lapi.Zrank(systemSid, userId, mid)
        if (rank === -1) {
            // The mid has never been synced before, add it to AppData
            // Add a score pair with system sequence number as score
            lapi.Zaddwithseq(systemSid, userId, mid)
            lapi.MiMeiSync(systemSid, "", mid, {})
            lapi.MiMeiProvide(systemSid, "", mid)
        }

        // ========================================================================
        // SCORE COMPARISON
        // ========================================================================
        
        // Get the current score from the remote host
        const remoteScore = lapi.RunMApp("node_get_score", { 
            aid: APP_ID, 
            ver: request.ver,
            nid: hostId,        // Remote host ID
            sid: systemSid,     // Necessary to prove the user's authenticity
            userid: userId, 
            mid: mid,
        }, [])

        // Get the current score from the local node
        const localScore = lapi.Zscore(systemSid, userId, mid)

        // ========================================================================
        // SCORE SYNCHRONIZATION
        // ========================================================================
        
        // If scores differ, sync and update the local score
        if (remoteScore !== localScore) {
            lapi.Debug("Tweed node_update_mid_by_score: mid=%s, new score=%s, old score=%s, userId=%s", mid, remoteScore, localScore, userId)
            
            // Sync the mid data from remote host
            try {
                lapi.MiMeiSync(systemSid, "", mid, {})
            } catch(e) {
                lapi.Error("Tweed node_update_mid_by_score: Failed to sync mid %s: %s", mid, e)
            }

            // Update the score of the user in local AppData
            try {
                const sp = getScorePair(remoteScore, mid)
                lapi.Zadd(systemSid, userId, sp)
            } catch(e) {
                lapi.Error("Tweed node_update_mid_by_score: Failed to update score for mid %s: %s", mid, e)
            }
        }
        return wrapResponse({success: true})
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error node_update_mid_by_score: %s, request=%s, stack=%s", e, JSON.stringify(request), e.stack || "no stack")
        return wrapError(e)
    }
    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Creates a score pair object for storing in sorted sets
     * @param {number} score - The score value
     * @param {string} member - The member identifier
     * @returns {Object} ScorePair object with Score and Member properties
     */
    function getScorePair(score, member) {
        function ScorePair() {}
        const sp = new ScorePair()
        sp.Score = score ? score : 0  // Use provided score or default to 0
        sp.Member = member  // Set the member identifier
        return sp
    }

})(request, args)