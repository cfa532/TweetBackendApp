((request, args) => {
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const APP_MARK = "package upgrade download"

        // get mid of upgrade app package.
        let authSid = lapi.BELoginAsAuthor()
        let mid = lapi.MMCreate(authSid, APP_ID, APP_EXT, APP_MARK, 1, 0x07276704)
        // let appVersion = lapi.GetVar("", "mimeiversions", mid)

        /**
         * http://tweet1.sharefire.store/upload
         * Login with account: developer, upload new installation package.
         * 9OCLYP-SXzen3e171-Ei_6N3Gwl installation package mimei.
         * command line tool: ./publish_upgrade.sh app-release.apk
         */
        let ret = {
            // version: appVersion.Versions[appVersion.Versions.length-1].Version,
            version: 28,  // set it larger than defaultConfig.versionName in build.gradle to force upgrade.
            packageId: mid,
            mission: "minor",     // App stop working without upgrade. minor, major, critical. Not used.
            domain: "t1.fireshare.store",   // base url to be used for deeplink and share.
        }
        console.log("check_upgrade", request["uid"], JSON.stringify(ret))
        return ret
    } catch(e) {
        console.error("Error check_upgrade", JSON.stringify(request), e)
    }
})(request, args)