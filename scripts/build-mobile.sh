#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib/common.sh"

TARGET="${1:-ios}"
require_cmd npm
ensure_node_modules

case "$TARGET" in
  ios)
    [[ "$(host_os)" == "macos" ]] || die "iOS builds require macOS + Xcode"
    require_cmd xcodebuild
    log "Generating/updating native iOS project..."
    (cd "$ROOT_DIR/mobile" && npx expo prebuild --platform ios --no-install)
    log "Building iOS development app..."
    (cd "$ROOT_DIR/mobile" && npx expo run:ios --no-install)
    ;;
  android)
    log "Generating/updating native Android project..."
    (cd "$ROOT_DIR/mobile" && npx expo prebuild --platform android --no-install)
    log "Building Android development app..."
    (cd "$ROOT_DIR/mobile" && npx expo run:android --no-install)
    ;;
  android-apk)
    require_cmd java
    log "Generating/updating native Android project..."
    (cd "$ROOT_DIR/mobile" && npx expo prebuild --platform android --no-install)
    log "Building Android debug APK..."
    (cd "$ROOT_DIR/mobile/android" && ./gradlew assembleDebug)
    log "APK: $ROOT_DIR/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
    ;;
  *)
    die "Usage: $0 [ios|android|android-apk]"
    ;;
esac
