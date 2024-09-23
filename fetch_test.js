let mid = "6IXx5IrJ7HeV_2I6Nb1hO4MPVKP"
let sender = "GyWQ8aVkv24TfxinrIPeFFam-NK"

let mmsid = lapi.MMOpen("", mid, "last")

let tsList = lapi.Zrangebyscore(mmsid, sender, 0, Date.now(), 0, 3)
console.log(JSON.stringify(tsList))

let messages = tsList.map(e => {
    console.log(JSON.stringify(e), sender)
    return lapi.Hget(mmsid, sender, e.Member)
}).filter(e => e)
console.log(JSON.stringify(messages))