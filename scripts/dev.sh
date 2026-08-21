#!/usr/bin/env bash
# Start every service needed to run machado in development:
#   • the Vite frontend (always)        → http://localhost:${WEB_PORT:-5173}
#   • the FastAPI backend (optional)     → http://${SERVER_HOST:-127.0.0.1}:${SERVER_PORT:-8000}
#
# The backend is the opt-in "server mode": if its Python deps aren't installed
# the script warns and starts the frontend alone (the app then runs 100% locally
# in the browser — exactly the intended fallback). Both processes are torn down
# together on Ctrl+C.
#
# Usage:
#   scripts/dev.sh                 # frontend + backend (backend skipped if unavailable)
#   scripts/dev.sh --frontend-only # only the Vite dev server
#   scripts/dev.sh --server-only   # only the FastAPI backend
#   scripts/dev.sh --fake-mt       # backend with MACHADO_FAKE_MT=1 (no NLLB model needed)
#
# Env overrides: WEB_PORT, SERVER_HOST, SERVER_PORT.
set -euo pipefail
# Enable job control so each backgrounded service becomes its own process-group
# leader — that lets us kill the whole tree (npm→vite, uvicorn→reload worker) at once.
set -m

# Resolve repo root from this script's location so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

WEB_PORT="${WEB_PORT:-5173}"
SERVER_HOST="${SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${SERVER_PORT:-8000}"

WANT_FRONTEND=1
WANT_SERVER=1
FAKE_MT=0

for arg in "$@"; do
  case "$arg" in
    --frontend-only) WANT_SERVER=0 ;;
    --server-only)   WANT_FRONTEND=0 ;;
    --fake-mt)       FAKE_MT=1 ;;
    -h|--help)
      # Print the leading comment block (lines after the shebang up to the first
      # non-comment line), stripping the leading "# ".
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

# ── pretty logging ─────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
  C_RESET=; C_BLUE=; C_GREEN=; C_YELLOW=; C_RED=
fi
info()  { echo "${C_BLUE}▸${C_RESET} $*"; }
ok()    { echo "${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}⚠${C_RESET} $*"; }
err()   { echo "${C_RED}✗${C_RESET} $*" >&2; }

# ── teardown: kill every started process group on exit ─────────────
PIDS=()
cleanup() {
  trap - INT TERM EXIT
  echo
  info "Shutting down…"
  for pid in "${PIDS[@]:-}"; do
    if [ -n "${pid}" ] && kill -0 "$pid" 2>/dev/null; then
      # Negative PID kills the whole process group (child + its subprocesses).
      kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  ok "All services stopped."
  exit 0
}
trap cleanup INT TERM EXIT

# ── backend ────────────────────────────────────────────────────────
start_server() {
  # Prefer the project venv; fall back to python3 on PATH.
  local py=""
  if [ -x "$ROOT/server/.venv/bin/python" ]; then
    py="$ROOT/server/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    py="$(command -v python3)"
  else
    warn "No Python interpreter found — skipping the backend (app runs locally in the browser)."
    return 1
  fi

  # The backend needs at least fastapi + uvicorn (the lightweight deps).
  if ! "$py" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
    warn "fastapi/uvicorn not installed for '$py' — skipping the backend."
    warn "Install with:  python -m venv server/.venv && server/.venv/bin/pip install -r server/requirements.txt"
    warn "(or the lightweight set: server/requirements-ci.txt). The app still works 100% locally."
    return 1
  fi

  info "Starting backend on http://${SERVER_HOST}:${SERVER_PORT} (using $py)"
  if [ "$FAKE_MT" = "1" ]; then
    warn "MACHADO_FAKE_MT=1 — deterministic stand-in translation (dev/test only, never production)."
  fi
  (
    cd "$ROOT/server"
    if [ "$FAKE_MT" = "1" ]; then export MACHADO_FAKE_MT=1; fi
    exec "$py" -m uvicorn app.main:app --host "$SERVER_HOST" --port "$SERVER_PORT" --reload
  ) &
  PIDS+=("$!")
  # Point the frontend at the backend so "server mode" can reach it in dev.
  export VITE_SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}"
  ok "Backend launched (health at /health). Enable 'server mode' in the app settings to use it."
  return 0
}

# ── frontend ───────────────────────────────────────────────────────
start_frontend() {
  if ! command -v npm >/dev/null 2>&1; then
    err "npm not found — install Node 18+ to run the frontend."
    exit 1
  fi
  if [ ! -d "$ROOT/node_modules" ]; then
    info "Installing frontend dependencies (npm install)…"
    npm install
  fi
  info "Starting frontend on http://localhost:${WEB_PORT}"
  ( exec npm run dev -- --port "$WEB_PORT" ) &
  PIDS+=("$!")
  ok "Frontend launched."
}

# ── orchestrate ────────────────────────────────────────────────────
if [ "$WANT_SERVER" = "1" ]; then
  start_server || true
fi
if [ "$WANT_FRONTEND" = "1" ]; then
  start_frontend
fi

if [ "${#PIDS[@]}" -eq 0 ]; then
  err "Nothing started."
  exit 1
fi

echo
ok "Running. Press Ctrl+C to stop."
# Poll the children (portable across bash versions — no `wait -n` needed). If any
# service exits on its own, tear the rest down via the EXIT trap.
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      warn "A service exited — shutting everything down."
      exit 1
    fi
  done
  sleep 1
done
