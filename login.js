((request, args)=>{
    try {
        const APP_ID = request["aid"]       // App ID assigned by Leither upon publication
        const APP_EXT = "com.example.twitterclone"
        const OWNER_DATA_KEY = "data_of_author"

        let authSid = lapi.BELoginAsAuthor()
        let userId = lapi.MMCreate(authSid, APP_ID, APP_EXT, request["phrase"], 2, 0x07276704)
        let mmsid = lapi.MMOpen(authSid, userId, "cur")
        console.log("Login userId", userId, request["phrase"])
        let user = lapi.Get(mmsid, OWNER_DATA_KEY)
        if (!user) {
            console.log("User does not exist.", request["username"])
            return
        }
        // need to check hashed password
        if (user.username == request["username"] && user.password == request["password"]) {
            delete user.password
            console.log("Login user", JSON.stringify(user))
            return user
        }
    } catch(e) {
        console.log("Error login", JSON.stringify(request), e)
    }
})(request, args)