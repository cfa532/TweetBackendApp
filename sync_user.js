/**
 * Sync User Function
 * 
 * This function synchronizes a user's data from their primary host to the current node.
 * It ensures the current node has the most up-to-date version of the user's data
 * by performing a synchronization operation.
 * 
 * Key Features:
 * - Syncs user data from primary host to current node
 * - Ensures data consistency across distributed nodes
 * - Handles user data synchronization
 * - Provides up-to-date user information
 * 
 * @param {Object} request - The request object containing sync data
 * @param {string} request.mid - User ID to synchronize
 * @param {Array} args - Additional arguments (unused)
 */

((request, args)=>{
    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        const userId = request["mid"]  // User ID to synchronize
        const authSid = lapi.BELoginAsAuthor()  // Get authentication session
        
        // Sync user data from primary host to current node
        lapi.MiMeiSync(authSid, "", userId, {})
    } catch(e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        console.error("Error sync_user:", JSON.stringify(request), e)
    }
})(request, args)