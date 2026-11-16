#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
LIMA_BIN="${LIMA_BIN:-$HOME/.local/share/reel-bot-lima/bin/limactl}"
if command -v docker >/dev/null 2>&1; then
  exec docker compose --project-directory "$PROJECT_DIR" "$@"
fi
exec "$LIMA_BIN" shell wa-hub -- docker compose --project-directory "$PROJECT_DIR" "$@"
