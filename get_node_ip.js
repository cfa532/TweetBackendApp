((request, args)=>{
    try {
        let ips = lapi.GetVar("", "ips", request["nodeid"])
        console.log("Node", request["nodeid"], ips)
        return ips
    } catch(e) {
        console.error("Error get_node_id", JSON.stringify(request), e)
    }
})(request, args)