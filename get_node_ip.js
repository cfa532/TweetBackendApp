/**
 * Given a node Id, return a IP address list
 */
((request, args)=>{
    const v4Only = request["v4only"] ? true : false;
    try {
        let ips = lapi.GetVar("", "ips", request["nodeid"])
        // Parse comma-separated string into array, filter out empty strings
        ips = ips.split(',').filter(ip => ip.trim() !== '')
        for (let element of ips) {
            // element format: ip:port
            const { ipAddress, port } = extractIPAndPort(element);
            if (port < 8000 || port > 9000) continue;
            if (isPrivateIP(ipAddress)) continue;
            
            // If v4Only is true, skip IPv6 addresses
            if (v4Only && isIPv6(ipAddress)) continue;
            
            // Found a valid IP, return it immediately
            return element;
        }
        return null; // No valid IP found
    } catch (e) {
        console.error("Error get_node_ip:", e, JSON.stringify(request));
    }

    // Extract IP address and port from a string that may contain both
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

    // Check if IPv4 is private
    function isPrivateIPv4(ip) {
        const parts = ip.split('.');
        if (parts.length !== 4) return false;
        const first = parseInt(parts[0], 10);
        const second = parseInt(parts[1], 10);
        if (first === 10) return true;
        if (first === 172 && second >= 16 && second <= 31) return true;
        if (first === 192 && second === 168) return true;
        if (first === 127) return true;
        if (first === 169 && second === 254) return true;
        return false;
    }

    // Check if IPv6 is private
    function isPrivateIPv6(ip) {
        // Remove brackets if present
        let cleanIp = ip;
        if (cleanIp.startsWith('[') && cleanIp.includes(']')) {
            cleanIp = cleanIp.slice(1, cleanIp.indexOf(']'));
        }
        cleanIp = cleanIp.toLowerCase();
        if (cleanIp === '::1') return true; // loopback
        if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true; // unique local
        if (cleanIp.startsWith('fe8') || cleanIp.startsWith('fe9') || cleanIp.startsWith('fea') || cleanIp.startsWith('feb')) return true; // link-local
        if (cleanIp.startsWith('::ffff:127.')) return true; // IPv4-mapped loopback
        return false;
    }

    // General private IP check
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

    // Check if an IP address is IPv6
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