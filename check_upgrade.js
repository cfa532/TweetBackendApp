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

        /**
         * http://tweet1.sharefire.store/upload
         * Login with account: developer, upload new installation package.
         * 9OCLYP-SXzen3e171-Ei_6N3Gwl installation package mimei.
         * command line tool: ./publish_upgrade.sh app-release.apk
         */
        return {
            // version: appVersion.Versions[appVersion.Versions.length-1].Version,
            version: 22,  // set it larger than defaultConfig.versionName in build.gradle to force upgrade.
            packageId: mid,
            mission: "minor",     // App stop working without upgrade. minor, major, critical. Not used.
            domain: "tweet2.sharefire.store",   // base url to be used for deeplink and share.
        }
    } catch(e) {
        console.error("Error check_upgrade", JSON.stringify(request), e)
    }
})(request, args)