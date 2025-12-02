/**
 * Node Get Score Function
 * 
 * This function retrieves the score of a specific mimei ID from the application data.
 * If the score doesn't exist, it assigns a global sequence number as the score.
 * Scores are used for tracking changes and ensuring data consistency across nodes.
 * 
 * Key Features:
 * - Retrieves mimei scores from application data
 * - Assigns global sequence numbers for new entries
 * - Handles missing score scenarios
 * - Provides score-based change tracking
 * 
 * @param {Object} request - The request object containing score data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - User ID associated with the score
 * @param {string} request.mid - Mimei ID to get score for
 * @param {Array} args - Additional arguments (unused)
 * @returns {number} Score value for the mimei ID
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const APP_ID = request["aid"]  // Application identifier
    const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)  // Open application data node
    const userId = request["userid"]  // User ID associated with the score
    const mid = request["mid"]  // Mimei ID to get score for
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === null || result === undefined) {
                return {success: false, message: "Score not found"}
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
        return null
    }
    
    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // Check if the mimei ID exists in the sorted set
        const rank = lapi.Zrank(mmsid, userId, mid)
        if (rank === -1) {
            // Score doesn't exist, assign the global sequence number as score of the mid
            lapi.Zaddwithseq(mmsid, userId, mid)
        }
        
        // Get and return the score (Zscore will throw exception if the scorepair doesn't exist)
        const score = lapi.Zscore(mmsid, userId, mid)
        return wrapResponse(score)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error node_get_score: %s, request=%s", e, JSON.stringify(request))
        return wrapError(e)
    }
})(request, args)