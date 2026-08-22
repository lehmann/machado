#!/usr/bin/env bash
# Upload the self-hosted local-engine ONNX models (web-models/) to a Cloudflare
# R2 bucket, so the browser fetches them from R2's CDN instead of this server —
# offloading IO from your origin (R2 egress is free). Run once, after
# scripts/fetch-models.mjs has populated web-models/. Re-running only copies
# changed files (rclone size/mtime check), so it's cheap/idempotent.
#
# Uses rclone over R2's S3-compatible API — a single static binary with NO Node
# dependency (wrangler needs Node 22+; this works on any Node/none at all).
#
# Prereqs:
#   • rclone installed: https://rclone.org/downloads/  (brew install rclone,
#     apt install rclone, or the official install script).
#   • An R2 bucket created (e.g. `machado-models`).
#   • An R2 *API token* (R2 → Manage R2 API Tokens → Create): gives an
#     Access Key ID + Secret Access Key. Export them plus your account id:
#         export R2_ACCESS_KEY_ID=...
#         export R2_SECRET_ACCESS_KEY=...
#         export R2_ACCOUNT_ID=...        # 32-hex from the R2 dashboard URL
#     (or set R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com directly).
#   No `rclone config` / interactive remote needed — we pass an inline backend.
#
# Usage:
#   scripts/upload-models-r2.sh <bucket> [--src DIR]
#   BUCKET=machado-models scripts/upload-models-r2.sh
#
# After uploading:
#   1. Bind a CUSTOM DOMAIN to the bucket (R2 → Settings → Custom Domains), e.g.
#      models.limao.uk — this puts the files behind Cloudflare's CDN and lets you
#      control headers. (Avoid the r2.dev URL for production.)
#   2. Set the bucket CORS policy so the app origin may fetch the files — edit
#      scripts/r2-cors.json with your origin and apply it (dashboard: R2 → bucket
#      → Settings → CORS Policy; or the S3 PutBucketCors API).
#   3. Build the SPA with VITE_MODELS_BASE=https://<your-domain>/ (setup-prod.sh
#      picks this up automatically; see server/README.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BUCKET="${BUCKET:-}"
SRC="$ROOT/web-models"

while [ $# -gt 0 ]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) BUCKET="$1"; shift ;;
  esac
done

[ -n "$BUCKET" ] || { echo "Usage: scripts/upload-models-r2.sh <bucket> [--src DIR]" >&2; exit 2; }
[ -d "$SRC" ] || { echo "Source dir not found: $SRC (run scripts/fetch-models.mjs first)" >&2; exit 1; }
command -v rclone >/dev/null 2>&1 || { echo "rclone not found — install it: https://rclone.org/downloads/" >&2; exit 1; }

: "${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID (R2 API token Access Key ID)}"
: "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY (R2 API token Secret Access Key)}"

# Endpoint: explicit R2_ENDPOINT wins, else derive from the account id.
ENDPOINT="${R2_ENDPOINT:-}"
if [ -z "$ENDPOINT" ]; then
  : "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID (or R2_ENDPOINT) — the 32-hex R2 account id}"
  ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi

echo "▸ Syncing $SRC → R2 bucket '$BUCKET' via $ENDPOINT"
# On-the-fly S3 backend (`:s3:`) configured entirely via --s3-* flags — no
# `rclone config` and no connection-string parsing (the inline `:s3,...:` form
# mis-parses the `://` in the endpoint). copy preserves the Xenova/<model>/<path>
# layout as the R2 key, so the URL matches what the worker requests
# (${base}/{model}/<file>). rclone sets Content-Type from the file extension
# (.json→application/json, .onnx→application/octet-stream). Long cache lifetime:
# models are versioned by path. --s3-no-check-bucket: object-scoped API tokens
# can't HEAD/create the bucket. region=auto is required for R2.
rclone copy "$SRC" ":s3:${BUCKET}" \
  --s3-provider Cloudflare \
  --s3-region auto \
  --s3-access-key-id "$R2_ACCESS_KEY_ID" \
  --s3-secret-access-key "$R2_SECRET_ACCESS_KEY" \
  --s3-endpoint "$ENDPOINT" \
  --s3-no-check-bucket \
  --header-upload "Cache-Control: public, max-age=31536000" \
  --transfers 4 \
  --progress

echo "✓ Uploaded to R2 bucket '$BUCKET'."
echo "Next: bind a custom domain + apply scripts/r2-cors.json, then build with VITE_MODELS_BASE."
