#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '\033[1;34m[PhotoX]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[PhotoX]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[PhotoX]\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

ensure_node_modules() {
  if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    log "Installing npm dependencies..."
    (cd "$ROOT_DIR" && npm install)
  fi
}

host_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux) echo linux ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo unknown ;;
  esac
}
