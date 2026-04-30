#!/bin/bash
if [ -z "$1" ]; then
  echo "Usage: ./release1_upgrade.sh app_release.apk"
  exit 1
fi

AppId="d4lRyhABgqOnqY4bURSm_T-4FZ4"     # Tweet App
FileId="p5-_uQPHjQpWI7gD4Zw65LrdRPm"    # upgrade APK
KeyFile=~/tweet/gen8.key
LeitherPath=~/tweet/Leither

# publish the upgrade APK and add reference to AppID, so when App is synced
# to a new node. The upgrade APK will be synced too, and provided.
# It is not working. Reference has to be added on "cur" before backup and publish.
# The following script is not adding it to cur.
"$LeitherPath" mimei setdata "$FileId" "$1" -k "$KeyFile"
"$LeitherPath" mimei ref add "$AppId" "$FileId" -k "$KeyFile"
"$LeitherPath" mimei publish "$FileId" -k "$KeyFile"
"$LeitherPath" mimei publish "$AppId" -k "$KeyFile"