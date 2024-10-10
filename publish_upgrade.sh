#!/bin/bash
if [ -z "$1" ]; then
  echo "Usage: ./publish_upgrade.sh app_release.apk"
  exit 1
fi

AppId="d4lRyhABgqOnqY4bURSm_T-4FZ4"
FileId="hdF-zawE_0MH0TSVuBvAU_yA0HA"
KeyFile="gen8.key"
LeitherPath="../darwin/Leither"

# Execute the commands with the provided arguments
"$LeitherPath" mimei setdata "$FileId" "$1" -k "$KeyFile"
"$LeitherPath" mimei ref add "$AppId" "$FileId"