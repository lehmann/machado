#!/usr/bin/env bash
# Provision machado for PRODUCTION on an Ubuntu server. One command that:
#   1. builds the frontend (dist/)                    → served by the API
#   2. creates server/.venv and installs the full ML stack (requirements.txt)
#   3. downloads the spaCy models (CEFR + grammar)
#   4. converts NLLB-200 → CTranslate2 (~5 GB one-time; skip with --skip-model)
#   5. installs a systemd unit "machado" that runs the API + SPA on one origin
#
# It is idempotent — re-running skips work already done. It does NOT modify the
# dev workflow (scripts/dev.sh is untouched); production is a separate path.
#
# Usage (run from anywhere, as a normal user with sudo rights):
#   scripts/setup-prod.sh                 # GPU (cuda), convert model, install systemd unit
#   scripts/setup-prod.sh --cpu           # run translation on CPU (no NVIDIA GPU)
#   scripts/setup-prod.sh --skip-model    # deps + spaCy only; convert NLLB later
#   scripts/setup-prod.sh --no-systemd    # prepare everything but don't touch systemd
#
# Env overrides: SERVER_HOST (0.0.0.0), SERVER_PORT (8002), SERVICE_NAME (machado),
#                SERVICE_USER (the invoking user).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

SERVER_HOST="${SERVER_HOST:-0.0.0.0}"
SERVER_PORT="${SERVER_PORT:-8002}"
SERVICE_NAME="${SERVICE_NAME:-machado}"
SERVICE_USER="${SERVICE_USER:-$(id -un)}"
SERVICE_GROUP="$(id -gn "$SERVICE_USER" 2>/dev/null || id -gn)"

CT2_DEVICE="cuda"
CT2_COMPUTE="int8_float16"
CONVERT_MODEL=1
WANT_SYSTEMD=1

for arg in "$@"; do
  case "$arg" in
    --cpu)        CT2_DEVICE="cpu"; CT2_COMPUTE="int8" ;;
    --skip-model) CONVERT_MODEL=0 ;;
    --no-systemd) WANT_SYSTEMD=0 ;;
    -h|--help)
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
die()   { err "$*"; exit 1; }

VENV="$ROOT/server/.venv"
PY="$VENV/bin/python"

# ── 0. preconditions ───────────────────────────────────────────────
info "Checking prerequisites…"
command -v node >/dev/null 2>&1 || die "node not found — install Node 18+ (e.g. via NodeSource)."
command -v npm  >/dev/null 2>&1 || die "npm not found — install Node 18+."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 18 ] || die "Node $(node -v) is too old — need 18+."
command -v python3 >/dev/null 2>&1 || die "python3 not found — install Python 3.11+."
python3 -c 'import venv' >/dev/null 2>&1 || \
  die "python3 venv module missing — run: sudo apt-get install -y python3-venv"
ok "node $(node -v), $(python3 --version)"

# ── 1. frontend build ──────────────────────────────────────────────
# No VITE_SERVER_URL → the SPA talks to the same origin, which is exactly the
# single-port layout the systemd unit serves. huggingface.token is never baked
# into a production build (vite.config injects an empty string in prod).
info "Building frontend (npm ci && npm run build)…"
# --include=dev: the build needs Vite (a devDependency); force it even if the
# server has NODE_ENV=production set, which would otherwise omit dev deps.
if [ -f "$ROOT/package-lock.json" ]; then
  npm ci --include=dev
else
  npm install --include=dev
fi
npm run build
ok "Frontend built → $ROOT/dist"

# ── 2. backend venv + full ML stack ────────────────────────────────
if [ ! -x "$PY" ]; then
  info "Creating virtualenv at server/.venv…"
  python3 -m venv "$VENV"
fi
info "Installing backend dependencies (server/requirements.txt)…"
"$PY" -m pip install --upgrade pip >/dev/null
"$PY" -m pip install -r "$ROOT/server/requirements.txt"
ok "Backend deps installed."

# ── 3. spaCy models (CEFR + grammar) ───────────────────────────────
info "Downloading spaCy models (pt + de)…"
"$PY" -m spacy download pt_core_news_sm
"$PY" -m spacy download de_core_news_sm
ok "spaCy models ready — CEFR and grammar will report available."

# ── 4. NLLB → CTranslate2 conversion ───────────────────────────────
if [ "$CONVERT_MODEL" = "1" ]; then
  if [ -d "$ROOT/server/models/nllb-200-distilled-1.3B-ct2" ]; then
    ok "NLLB model already converted — skipping."
  else
    # torch is required to read the HF PyTorch weights during conversion only
    # (CTranslate2 runtime doesn't use it). CPU wheel — conversion is CPU-bound.
    info "Installing one-time conversion deps (torch, CPU)…"
    "$PY" -m pip install -r "$ROOT/server/requirements-convert.txt"
    info "Converting NLLB-200 → CTranslate2 (~5 GB download, one-time)…"
    # ct2-transformers-converter lives in the venv; put it on PATH.
    PATH="$VENV/bin:$PATH" bash "$ROOT/server/scripts/convert_model.sh"
    ok "NLLB model converted."
  fi
else
  warn "Skipping NLLB conversion (--skip-model). /translate stays 503 until you run:"
  warn "  $PY -m pip install -r server/requirements-convert.txt   # torch (CPU), conversion only"
  warn "  PATH=\"$VENV/bin:\$PATH\" bash server/scripts/convert_model.sh"
fi

# ── 5. systemd unit ────────────────────────────────────────────────
if [ "$WANT_SYSTEMD" = "1" ]; then
  UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
  info "Installing systemd unit → $UNIT_PATH (device: $CT2_DEVICE)…"
  # An optional env file lets you tweak runtime vars without regenerating the
  # unit (e.g. NLLB_CT2_PATH, BEAM_SIZE). The leading '-' makes it optional.
  ENV_FILE="$ROOT/server/.env.prod"
  UNIT_CONTENT="$(cat <<EOF
[Unit]
Description=machado (PT-BR <-> DE translator) — API + SPA on one origin
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${ROOT}/server
EnvironmentFile=-${ENV_FILE}
Environment=MACHADO_STATIC_DIR=${ROOT}/dist
Environment=CT2_DEVICE=${CT2_DEVICE}
Environment=CT2_COMPUTE=${CT2_COMPUTE}
ExecStart=${VENV}/bin/uvicorn app.main:app --host ${SERVER_HOST} --port ${SERVER_PORT}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
)"
  echo "$UNIT_CONTENT" | sudo tee "$UNIT_PATH" >/dev/null
  sudo systemctl daemon-reload
  ok "systemd unit '${SERVICE_NAME}' installed."
  echo
  info "Start it with:  scripts/start-prod.sh        (enables + starts on boot)"
  info "Logs:           journalctl -u ${SERVICE_NAME} -f"
  [ "$CT2_DEVICE" = "cuda" ] && \
    warn "GPU: ensure the NVIDIA driver is installed and '${SERVICE_USER}' can access /dev/nvidia* (video/render groups)."
else
  warn "Skipped systemd (--no-systemd). Run manually with:"
  warn "  MACHADO_STATIC_DIR=$ROOT/dist CT2_DEVICE=$CT2_DEVICE CT2_COMPUTE=$CT2_COMPUTE \\"
  warn "  $VENV/bin/uvicorn app.main:app --host $SERVER_HOST --port $SERVER_PORT   (run from server/)"
fi

echo
ok "Setup complete. The app will be served at http://${SERVER_HOST}:${SERVER_PORT}/"
