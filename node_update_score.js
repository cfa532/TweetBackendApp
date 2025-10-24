/**
 * Node Update Score Function
 * 
 * This function updates the score of a given mimei ID in the application data.
 * Any change in the mimei will be reflected in the AppData to track modifications
 * and ensure data consistency across the distributed network.
 * 
 * Key Features:
 * - Updates mimei scores in application data
 * - Tracks changes to mimei content
 * - Maintains score consistency across nodes
 * - Uses global sequence numbers for change tracking
 * 
 * Score Update Logic:
 * - On the host of the mimei: score is updated to reflect changes made to it
 * - On other nodes: score is updated to remember score of a single source of truth
 * 
 * @param {Object} request - The request object containing score update data
 * @param {string} request.aid - Application ID
 * @param {string} request.userid - User ID associated with the mimei
 * @param {string} request.mid - Mimei ID to update score for
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    try {
        const APP_ID = request["aid"]  // Application identifier
        const userId = request["userid"]  // User ID associated with the mimei
        const mid = request["mid"]  // Mimei ID to update score for
        const mmsid = lapi.BEOpenAppDataNode("cur", APP_ID)  // Open application data node
        
        // ========================================================================
        // MAIN EXECUTION
        // ========================================================================
        
        // Update the score of the given mimei ID in AppData
        // Any change in the mimei will be reflected in the AppData
        let ret = lapi.Zaddwithseq(mmsid, userId, mid)
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error node_update_score", e, JSON.stringify(request))
    }
})(request, args)