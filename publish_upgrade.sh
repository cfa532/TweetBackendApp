#!/bin/bash
if [ -z "$1" ]; then
  echo "Usage: ./publish_upgrade.sh app_release.apk"
  exit 1
fi

AppId="d4lRyhABgqOnqY4bURSm_T-4FZ4"     # Tweet App
FileId="hdF-zawE_0MH0TSVuBvAU_yA0HA"    # upgrade APK
KeyFile="gen8.key"
LeitherPath=~/tweet/Leither

# publish the upgrade APK and add reference to AppID, so when App is synced
# to a new node. The upgrade APK will be synced too, and provided.
"$LeitherPath" mimei setdata "$FileId" "$1" -k "$KeyFile"
"$LeitherPath" mimei ref add "$AppId" "$FileId" -k "$KeyFile"