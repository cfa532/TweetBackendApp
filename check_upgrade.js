((request, args) => {
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const APP_MARK = "package upgrade download"

        // get mid of upgrade app package.
        let authSid = lapi.BELoginAsAuthor()
        let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 1, 0x07276704)
        let appVersion = lapi.GetVar("", "mimeiversions", mid)
        console.log("Package ver:", JSON.stringify(appVersion), mid)

        //{
        // "Versions":[{"Version":"1","MacRes":"QmRTT1L6pxpeyptApszu9LYzNn9sMgoJg6qgTpCe54gqGD","MacRef":"MqKW0iTyhcZ77pPDD4owkVfw2ql"}],
        // "SpecialVers":[{"VerName":"last","Version":"1"}],
        // "MinDifSeq":0
        // }
        // hdF-zawE_0MH0TSVuBvAU_yA0HA  upgrade package mimei
        // When uploading new installation package, call the following code.
        // ./publish_upgrade.sh app-release.apk
        //
        return {
            version: appVersion.Versions[appVersion.Versions.length-1].Version,
            packageId: mid,
            mission: "minor",     // App stop working without upgrade. minor, major, critical. Not used.
            domain: "twbe.fireshare.us",
        }
    } catch(e) {
        console.error("check_upgrade", JSON.stringify(request), e)
    }
})(request, args)