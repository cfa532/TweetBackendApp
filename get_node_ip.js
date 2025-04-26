/**
 * Given a node Id, return a IP address list
 */
((request, args)=>{
    try {
        let ips = lapi.GetVar("", "ips", request["nodeid"])
        return ips
    } catch(e) {
        console.error("Error get_node_id", JSON.stringify(request), e)
    }
})(request, args)