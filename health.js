((request, args)=>{
    const version = request?.version || ""  // Version identifier for API compatibility
    
    const result = {
        "status": "ok",
        "message": "Server is running"
    }
    
    if (version === 'v2') {
        return {success: true, data: result}
    }
    return result
})(request, args)