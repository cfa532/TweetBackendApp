/**
 * Verify Agent Token Function
 * 
 * This function verifies AI agent authentication tokens.
 * It uses Ed25519 digital signatures to verify that requests are authorized
 * by users without requiring passwords.
 * 
 * Call this function from other server functions via:
 *   const result = lapi.RunMApp("verify_agent_token", {
 *       aid: APP_ID,
 *       ver: "last",
 *       agentAuth: { mimeiId, timestamp, signature },
 *       requestData: { authorId, content, ... }
 *   }, [])
 * 
 * @param {Object} request - The request object
 * @param {string} request.aid - Application ID (mandatory)
 * @param {string} request.ver - Version identifier (mandatory)
 * @param {Object} request.agentAuth - Agent authentication data
 * @param {string} request.agentAuth.mimeiId - User's Mimei ID
 * @param {number} request.agentAuth.timestamp - Request timestamp (Unix ms)
 * @param {string} request.agentAuth.signature - Base64-encoded Ed25519 signature
 * @param {Object} request.requestData - The data that was signed
 * @returns {Object} {valid: boolean, error?: string, mimeiId?: string}
 */
((request, args) => {
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const APP_ID = request["aid"]  // Application ID (mandatory)
    const version = request["ver"] || "last"  // Version identifier (mandatory)
    const OWNER_DATA_KEY = "data_of_author"
    const MAX_REQUEST_AGE_MS = 5 * 60 * 1000  // 5 minutes
    
    // ============================================================================
    // MAIN EXECUTION
    // ============================================================================
    
    try {
        // Validate mandatory parameters
        if (!APP_ID) {
            return { valid: false, error: "Missing mandatory parameter: aid" }
        }
        
        const agentAuth = request.agentAuth
        const requestData = request.requestData || {}
        
        // 1. Validate agentAuth structure
        if (!agentAuth || !agentAuth.mimeiId || !agentAuth.timestamp || !agentAuth.signature) {
            return { valid: false, error: "Missing required agentAuth fields" }
        }
        
        // 2. Check timestamp freshness (prevent replay attacks)
        const now = Date.now()
        const requestAge = now - agentAuth.timestamp
        if (requestAge > MAX_REQUEST_AGE_MS) {
            lapi.Warn("Tweed verify_agent_token: Request expired, age=%dms, max=%dms", requestAge, MAX_REQUEST_AGE_MS)
            return { valid: false, error: "Request expired" }
        }
        if (requestAge < -60000) {  // Allow 1 minute clock skew into the future
            lapi.Warn("Tweed verify_agent_token: Request timestamp in future, age=%dms", requestAge)
            return { valid: false, error: "Invalid timestamp" }
        }
        
        // 3. Get user's agent public key
        let userData
        try {
            const userMmsid = lapi.MMOpen("", agentAuth.mimeiId, "last")
            userData = lapi.Get(userMmsid, OWNER_DATA_KEY)
        } catch(e) {
            lapi.Error("Tweed verify_agent_token: Failed to get user data for %s: %s", agentAuth.mimeiId, e)
            return { valid: false, error: "User not found" }
        }
        
        if (!userData || !userData.agentPublicKey) {
            lapi.Warn("Tweed verify_agent_token: No agent public key configured for user %s", agentAuth.mimeiId)
            return { valid: false, error: "Agent not configured for this user" }
        }
        
        // 4. Reconstruct the signed data (must match client-side signing)
        const signedData = Object.assign({}, requestData, {
            mimeiId: agentAuth.mimeiId,
            timestamp: agentAuth.timestamp
        })
        
        // Sort keys for consistent JSON serialization
        const sortedData = sortObjectKeys(signedData)
        const messageString = JSON.stringify(sortedData)
        
        // 5. Verify Ed25519 signature
        const isValid = verifyEd25519(
            messageString,
            agentAuth.signature,
            userData.agentPublicKey
        )
        
        if (isValid) {
            lapi.Debug("Tweed verify_agent_token: Valid signature for user %s, app=%s", agentAuth.mimeiId, APP_ID)
            return { valid: true, mimeiId: agentAuth.mimeiId }
        } else {
            lapi.Warn("Tweed verify_agent_token: Invalid signature for user %s, app=%s", agentAuth.mimeiId, APP_ID)
            return { valid: false, error: "Invalid signature" }
        }
        
    } catch(e) {
        lapi.Error("Tweed verify_agent_token: Verification error: %s, app=%s", e, APP_ID)
        return { valid: false, error: "Verification failed: " + e.message }
    }
    
    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Sort object keys recursively for consistent JSON serialization
     */
    function sortObjectKeys(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj
        }
        if (Array.isArray(obj)) {
            return obj.map(sortObjectKeys)
        }
        const sorted = {}
        Object.keys(obj).sort().forEach(key => {
            sorted[key] = sortObjectKeys(obj[key])
        })
        return sorted
    }
    
    /**
     * Verify Ed25519 signature
     */
    function verifyEd25519(message, signatureBase64, publicKeyBase64) {
        const messageBytes = stringToBytes(message)
        const sigBytes = base64ToBytes(signatureBase64)
        const pubKeyBytes = base64ToBytes(publicKeyBase64)
        
        // Use Leither's built-in verification if available
        if (typeof lapi.Ed25519Verify === 'function') {
            return lapi.Ed25519Verify(messageBytes, sigBytes, pubKeyBytes)
        }
        
        // Fallback: Use nacl if available in the environment
        if (typeof nacl !== 'undefined' && nacl.sign && nacl.sign.detached) {
            return nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes)
        }
        
        lapi.Error("Tweed verify_agent_token: No Ed25519 verification available")
        return false
    }
    
    /**
     * Convert string to Uint8Array (UTF-8)
     */
    function stringToBytes(str) {
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(str)
        }
        // Fallback for environments without TextEncoder
        const bytes = []
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i)
            if (code < 0x80) {
                bytes.push(code)
            } else if (code < 0x800) {
                bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
            } else {
                bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
            }
        }
        return new Uint8Array(bytes)
    }
    
    /**
     * Convert Base64 string to Uint8Array
     */
    function base64ToBytes(base64) {
        if (typeof atob === 'function') {
            const binary = atob(base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i)
            }
            return bytes
        }
        // Fallback for Node.js
        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(base64, 'base64'))
        }
        return new Uint8Array(0)
    }
})(request, args)
