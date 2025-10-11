/**
 * Given a mimei Id, return the best IP address of providers, excluding private IPs (IPv4 and IPv6)
 * "[[[\"115.205.180.247:8002\", 1942861047],[\"[240e:391:edd:26d0:b25a:daff:fe87:21d4]:8002\", 39642857350864],[\"192.168.10.5:8002\", 281478208948741]]]"
 */
((request, args) => {
    const v4Only = request["v4only"] === "true" ? true : false;
    const mid = request["mid"];
    const providers = JSON.parse(lapi.GetVar("", "mmprovsips", mid));

    try {
        if (!providers || !Array.isArray(providers)) return null
        let ip = "", mini = null;
        providers.forEach(element => {
            element.forEach(element2 => {
                // element2 format: [ip:port, score]
                const { ipAddress, port } = extractIPAndPort(element2[0]);
                if (port < 8000 || port > 9000) return;
                if (isPrivateIP(ipAddress)) return;
                if (v4Only && !isIPv4(ipAddress)) return;
                if (mini === null || element2[1] < mini) {
                    mini = element2[1];
                    ip = element2[0];
                }
            });
        });
        return ip;
    } catch (e) {
        console.error("Error get_provider_ip:", e, JSON.stringify(request));
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
        // Block 26.26.26.* range
        if (first === 26 && second === 26 && parseInt(parts[2], 10) === 26) return true;
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

    // Check if IP is IPv4
    function isIPv4(ip) {
        // IPv6 with brackets
        if (ip.startsWith('[')) {
            return false;
        }
        // Split out port if present
        const ipPart = ip.split(':')[0];
        if (ipPart.includes(':')) {
            // IPv6 without brackets
            return false;
        }
        // IPv4
        return true;
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
})(request, args); 