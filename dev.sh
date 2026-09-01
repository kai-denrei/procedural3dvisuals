#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev.sh — one command to develop: static server + cache-bust-on-save watcher.
#
#   ./dev.sh              dev cache mode (no-store; you always see the file on disk)
#   ./dev.sh --prod       production cache recipe, to verify busting really works
#   ./dev.sh --port 9000
#
# The watcher includes shaders/ — the skill's default path list does not, and
# shaders are the files that change most often here.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

SKILL_DIR="${CB_SKILL_DIR:-$HOME/.claude-kainode/skills/cache-busting}"
PORT=8080
MODE=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --prod) MODE+=(--prod); shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

cleanup() { jobs -p | xargs -r kill 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if [[ -x "$SKILL_DIR/scripts/watch.sh" || -f "$SKILL_DIR/scripts/watch.sh" ]]; then
  echo "  watcher: shaders src public  →  bumps token on save"
  bash "$SKILL_DIR/scripts/watch.sh" --target . --paths "shaders src public" &
else
  echo "  ! cache-busting skill not found at $SKILL_DIR — running without watcher."
  echo "    Set CB_SKILL_DIR to override."
fi

exec node serve.mjs --port "$PORT" "${MODE[@]}"
