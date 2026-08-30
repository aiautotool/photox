#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib/common.sh"

[[ "$(host_os)" == "macos" ]] || die "Installing to a physical iOS device requires macOS"
require_cmd npm
require_cmd xcodebuild
require_cmd xcrun
ensure_node_modules

DEVICE="${IOS_DEVICE:-${1:-}}"

log "Connected iOS devices:"
xcrun xctrace list devices 2>/dev/null | sed -n '/== Devices ==/,/== Simulators ==/p' || true

cd "$ROOT_DIR/mobile"

if [[ ! -d ios ]]; then
  log "Native iOS project not found; running Expo prebuild..."
  npx expo prebuild --platform ios --no-install
fi

if [[ -n "$DEVICE" ]]; then
  log "Building and installing PhotoSync on iOS device: $DEVICE"
  npx expo run:ios --device "$DEVICE" --no-install
else
  log "No IOS_DEVICE supplied; Expo will show the connected-device picker."
  npx expo run:ios --device --no-install
fi

log "Install command completed. If iOS asks, enable Developer Mode and trust the developer certificate on the device."
