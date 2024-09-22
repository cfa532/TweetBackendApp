((request, args) => {
    try {
        return {
            appVersion: "1.0.0",
            packageId: ""
        }
    } catch(e) {
        console.error(e)
    }
})(request, args)