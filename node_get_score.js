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
    
    const APP_ID = request["aid"]  // Application identifier
    const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)  // Open application data node
    const userId = request["userid"]  // User ID associated with the score
    const mid = request["mid"]  // Mimei ID to get score for
    
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
        return lapi.Zscore(mmsid, userId, mid)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Error node_get_score", e, JSON.stringify(request))
    }
})(request, args)