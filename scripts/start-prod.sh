#!/usr/bin/env bash
# Control the machado production service (installed by scripts/setup-prod.sh as a
# systemd unit). Thin wrapper around systemctl so you don't have to remember the
# unit name.
#
# Usage:
#   scripts/start-prod.sh            # enable + start now (survives reboots)
#   scripts/start-prod.sh start      # same as above
#   scripts/start-prod.sh stop       # stop (leaves it enabled for next boot)
#   scripts/start-prod.sh restart    # restart (use after a rebuild/redeploy)
#   scripts/start-prod.sh status     # show status
#   scripts/start-prod.sh logs       # follow the journal (Ctrl+C to detach)
#   scripts/start-prod.sh disable    # stop + disable (don't start on boot)
#
# Env override: SERVICE_NAME (default: machado).
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-machado}"
ACTION="${1:-start}"

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'
else
  C_RESET=; C_GREEN=; C_RED=
fi
ok()  { echo "${C_GREEN}✓${C_RESET} $*"; }
err() { echo "${C_RED}✗${C_RESET} $*" >&2; }

# --help needs no systemd unit — handle it before the precondition check.
if [ "$ACTION" = "-h" ] || [ "$ACTION" = "--help" ]; then
  awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
  exit 0
fi

# Fail early with a clear hint if setup hasn't run yet.
if [ ! -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
  err "systemd unit '${SERVICE_NAME}' not found — run scripts/setup-prod.sh first."
  exit 1
fi

case "$ACTION" in
  start)
    sudo systemctl enable --now "$SERVICE_NAME"
    ok "'${SERVICE_NAME}' enabled and started."
    sudo systemctl --no-pager --full status "$SERVICE_NAME" || true
    ;;
  stop)
    sudo systemctl stop "$SERVICE_NAME"
    ok "'${SERVICE_NAME}' stopped."
    ;;
  restart)
    sudo systemctl restart "$SERVICE_NAME"
    ok "'${SERVICE_NAME}' restarted."
    ;;
  status)
    sudo systemctl --no-pager --full status "$SERVICE_NAME"
    ;;
  logs)
    exec sudo journalctl -u "$SERVICE_NAME" -f
    ;;
  disable)
    sudo systemctl disable --now "$SERVICE_NAME"
    ok "'${SERVICE_NAME}' stopped and disabled."
    ;;
  *)
    err "Unknown action: $ACTION (see --help)"
    exit 2
    ;;
esac
