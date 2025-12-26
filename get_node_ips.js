/**
 * Get Node IPs Function
 * 
 * This function retrieves all valid public IP addresses for a given node ID.
 * It filters out private IPs, invalid ports, and optionally IPv6 addresses.
 * 
 * Key Features:
 * - Filters out private IP addresses (IPv4 and IPv6)
 * - Validates port ranges (8000-9000)
 * - Optional IPv4-only filtering
 * - Handles both IPv4 and IPv6 addresses
 * - Supports bracketed IPv6 notation
 * - Returns a list of all valid IP addresses
 * 
 * @param {Object} request - The request object containing node data
 * @param {string} request.nodeid - Node ID to get IP addresses for
 * @param {string} [request.v4only] - If "true", only return IPv4 addresses
 * @param {Array} args - Additional arguments (unused)
 * @returns {Array<string>|null} Array of valid IP addresses with ports, or null if none found
 */
((request, args)=>{
    // ============================================================================
    // CONSTANTS AND INITIALIZATION
    // ============================================================================
    
    const version = request.version || ""  // Version identifier for API compatibility
    const v4Only = request["v4only"] === "true" ? true : false;  // IPv4-only filter flag
    
    // Helper function to wrap response in v2 format if needed
    function wrapResponse(result) {
        if (version === 'v2') {
            if (result === null || result === undefined || (Array.isArray(result) && result.length === 0)) {
                return {success: false, message: "No valid node IPs found"}
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
        // Get IP addresses for the specified node
        let ips = lapi.GetVar("", "ips", request["nodeid"])
        if (!ips) return wrapResponse([])
        
        // Parse comma-separated string into array, filter out empty strings
        ips = ips.split(',').filter(ip => ip.trim() !== '')
        
        // Array to collect all valid IP addresses
        const validIPs = []
        
        // Check each IP address for validity
        for (let element of ips) {
            // element format: ip:port
            const { ipAddress, port } = extractIPAndPort(element);
            
            // Validate port range (8000-9000)
            if (port < 8000 || port > 9000) continue;
            
            // Skip private IP addresses
            if (isPrivateIP(ipAddress)) continue;
            
            // If v4Only is true, skip IPv6 addresses
            if (v4Only && isIPv6(ipAddress)) continue;
            
            // Found a valid IP, add it to the list
            validIPs.push(element);
        }
        
        // Return all valid IPs (empty array if none found)
        return wrapResponse(validIPs.length > 0 ? validIPs : []);
    } catch (e) {
        // ========================================================================
        // ERROR HANDLING
        // ========================================================================
        
        lapi.Error("Tweed Error get_node_ips: %s, request=%s", e, JSON.stringify(request));
        return wrapError(e);
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    
    /**
     * Extracts IP address and port from a string that may contain both
     * @param {string} ipPortString - String containing IP and optionally port
     * @returns {Object} Object with ipAddress and port properties
     */
    function extractIPAndPort(ipPortString) {
        let ipAddress, port;
        
        // Handle IPv6 with brackets: [2001:db8::1]:8080
        if (ipPortString.startsWith('[') && ipPortString.includes(']')) {
            const bracketEnd = ipPortString.indexOf(']');
            ipAddress = ipPortString.substring(1, bracketEnd);
            const portPart = ipPortString.substring(bracketEnd + 1);
            port = portPart.startsWith(':') ? parseInt(portPart.substring(1), 10) : null;
        } else {
            // Handle IPv4 or IPv6 without brackets
            const lastColonIndex = ipPortString.lastIndexOf(':');
            if (lastColonIndex !== -1) {
                // Check if this is likely a port (last part should be numeric)
                const potentialPort = ipPortString.substring(lastColonIndex + 1);
                if (/^\d+$/.test(potentialPort)) {
                    ipAddress = ipPortString.substring(0, lastColonIndex);
                    port = parseInt(potentialPort, 10);
                } else {
                    // No port specified, entire string is IP
                    ipAddress = ipPortString;
                    port = null;
                }
            } else {
                // No colon found, no port
                ipAddress = ipPortString;
                port = null;
            }
        }
        
        return { ipAddress, port };
    }

    /**
     * Checks if an IPv4 address is private
     * @param {string} ip - IPv4 address to check
     * @returns {boolean} True if the IP is private
     */
    function isPrivateIPv4(ip) {
        const parts = ip.split('.');
        if (parts.length !== 4) return false;
        const first = parseInt(parts[0], 10);
        const second = parseInt(parts[1], 10);
        
        // Standard private IP ranges
        if (first === 10) return true;  // 10.0.0.0/8
        if (first === 172 && second >= 16 && second <= 31) return true;  // 172.16.0.0/12
        if (first === 192 && second === 168) return true;  // 192.168.0.0/16
        if (first === 127) return true;  // 127.0.0.0/8 (loopback)
        if (first === 169 && second === 254) return true;  // 169.254.0.0/16 (link-local)
        
        // Block specific problematic range
        if (first === 26 && second === 26 && parseInt(parts[2], 10) === 26) return true;
        return false;
    }

    /**
     * Checks if an IPv6 address is private
     * @param {string} ip - IPv6 address to check
     * @returns {boolean} True if the IP is private
     */
    function isPrivateIPv6(ip) {
        // Remove brackets if present
        let cleanIp = ip;
        if (cleanIp.startsWith('[') && cleanIp.includes(']')) {
            cleanIp = cleanIp.slice(1, cleanIp.indexOf(']'));
        }
        cleanIp = cleanIp.toLowerCase();
        
        // Standard private IPv6 ranges
        if (cleanIp === '::1') return true; // loopback
        if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true; // unique local (fc00::/7)
        if (cleanIp.startsWith('fe8') || cleanIp.startsWith('fe9') || cleanIp.startsWith('fea') || cleanIp.startsWith('feb')) return true; // link-local (fe80::/10)
        if (cleanIp.startsWith('::ffff:127.')) return true; // IPv4-mapped loopback
        return false;
    }

    /**
     * General private IP check for both IPv4 and IPv6
     * @param {string} ip - IP address to check
     * @returns {boolean} True if the IP is private
     */
    function isPrivateIP(ip) {
        // IPv6 with brackets
        if (ip.startsWith('[')) {
            return isPrivateIPv6(ip);
        }
        // Split out port if present
        const ipPart = ip.split(':')[0];
        if (ipPart.includes(':')) {
            // IPv6 without brackets
            return isPrivateIPv6(ipPart);
        }
        // IPv4
        return isPrivateIPv4(ipPart);
    }

    /**
     * Checks if an IP address is IPv6
     * @param {string} ip - IP address to check
     * @returns {boolean} True if the IP is IPv6
     */
    function isIPv6(ip) {
        // Remove brackets if present
        let cleanIp = ip;
        if (cleanIp.startsWith('[') && cleanIp.includes(']')) {
            cleanIp = cleanIp.slice(1, cleanIp.indexOf(']'));
        }
        // IPv6 addresses contain colons and are typically longer than IPv4
        return cleanIp.includes(':');
    }
})(request, args)

