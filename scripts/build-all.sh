#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"$SCRIPT_DIR/build-mobile.sh" "${MOBILE_TARGET:-ios}"
"$SCRIPT_DIR/build-desktop.sh" "${DESKTOP_TARGET:-auto}"
