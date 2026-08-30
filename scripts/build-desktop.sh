#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib/common.sh"

TARGET="${1:-auto}"
require_cmd npm
ensure_node_modules

if [[ "$TARGET" == "auto" ]]; then
  case "$(host_os)" in
    macos) TARGET="mac" ;;
    windows) TARGET="win" ;;
    *) TARGET="build" ;;
  esac
fi

case "$TARGET" in
  build)
    log "Building desktop application..."
    (cd "$ROOT_DIR" && npm --workspace @photosync/desktop run build)
    ;;
  mac|mac-arm64)
    [[ "$(host_os)" == "macos" ]] || die "macOS installers must be built on macOS"
    log "Building macOS arm64 DMG/ZIP..."
    (cd "$ROOT_DIR" && npm --workspace @photosync/desktop run dist:mac:arm64)
    ;;
  mac-x64)
    [[ "$(host_os)" == "macos" ]] || die "macOS installers must be built on macOS"
    log "Building macOS x64 DMG/ZIP..."
    (cd "$ROOT_DIR" && npm --workspace @photosync/desktop run dist:mac:x64)
    ;;
  win|windows)
    log "Building Windows x64 NSIS installer..."
    (cd "$ROOT_DIR" && npm --workspace @photosync/desktop run dist:win)
    ;;
  *)
    die "Usage: $0 [auto|build|mac|mac-arm64|mac-x64|win]"
    ;;
esac

log "Desktop output: $ROOT_DIR/desktop/release"
