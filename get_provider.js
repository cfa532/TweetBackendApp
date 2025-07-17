/**
 * Given a mimei Id, return the best IP address of providers, excluding private IPs (IPv4 and IPv6)
 */
((request, args) => {
    const mid = request["mid"];
    const providers = JSON.parse(lapi.GetVar("", "mmprovsips", mid));

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

    try {
        let ip = "", mini = null;
        providers.forEach(element => {
            element.forEach(element2 => {
                // element2 format: [ip:port, score]
                const parts = element2[0].split(":");
                const port = parseInt(parts[parts.length - 1], 10);
                if (port < 8000 || port > 9000) return;
                if (isPrivateIP(element2[0])) return;
                if (mini === null || element2[1] < mini) {
                    mini = element2[1];
                    ip = element2[0];
                }
            });
        });
        return ip;
    } catch (e) {
        console.error("Error get_provider:", e, JSON.stringify(request));
    }
})(request, args); 