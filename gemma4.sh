#!/usr/bin/env bash
# gemma4.sh — Start Gemma 4 26B on llama-server with OpenClaw-ready settings
#
# Usage:
#   ./gemma4.sh              # defaults: port 8081, 100K ctx/slot, LAN accessible
#   ./gemma4.sh -p 8082      # custom port
#   ./gemma4.sh -c 50000     # smaller context (50K per slot)
#   ./gemma4.sh -l           # localhost only (no LAN access)
#
# Note: -c sets usable context PER SLOT. The actual --ctx-size passed to
# llama-server is multiplied by --parallel (default 2), so OpenClaw sees
# the full -c value. Boot time ~65s at 100K ctx due to KV cache allocation.
#
# OpenClaw config (copy into your openclaw config):
#   base_url: http://<this-mac-ip>:8081/v1
#   model: gemma-4-26B-A4B-it-UD-Q4_K_M.gguf

set -euo pipefail

# --- Config ---
MODEL="/Volumes/James4TBSSD/llms/gemma4-26b-q4/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf"
PORT=8081
CTX_PER_SLOT=100000  # usable context per slot (what OpenClaw sees)
N_PARALLEL=2          # concurrent request slots
HOST="0.0.0.0"      # LAN accessible by default
GPU_LAYERS=-1       # -1 = offload all layers to Metal
FLASH_ATTN="on"     # Flash Attention — critical for 100K context
CACHE_TYPE_K="q4_0" # KV cache key quantization — saves ~75% memory vs f16
CACHE_TYPE_V="q4_0" # KV cache value quantization — saves ~75% memory vs f16

# --- Parse args ---
while getopts "p:c:lh" opt; do
  case $opt in
    p) PORT="$OPTARG" ;;
    c) CTX_PER_SLOT="$OPTARG" ;;
    l) HOST="127.0.0.1" ;;   # localhost only
    h)
      echo "Usage: $0 [-p PORT] [-c CTX_SIZE] [-l] [-h]"
      echo "  -p PORT     Port number (default: 8081)"
      echo "  -c CTX      Usable context per slot in tokens (default: 100000)"
      echo "  -l          Listen on localhost only (no LAN access)"
      echo "  -h          Show this help"
      exit 0
      ;;
    *) exit 1 ;;
  esac
done

# --- Validate ---
if [[ ! -f "$MODEL" ]]; then
  echo "ERROR: Model file not found: $MODEL"
  echo "Update the MODEL path in this script."
  exit 1
fi

# --- Compute actual ctx-size (must account for parallel slots) ---
CTX_TOTAL=$((CTX_PER_SLOT * N_PARALLEL))

# --- Print config ---
echo "╔══════════════════════════════════════════════════╗"
echo "║           Gemma 4 26B — llama-server             ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Model:   $(basename "$MODEL")"
echo "║  Host:    $HOST"
echo "║  Port:    $PORT"
echo "║  Context: ${CTX_PER_SLOT} tokens/slot x ${N_PARALLEL} slots = ${CTX_TOTAL} total"
echo "║  GPU:     All layers (Metal) (parallel=$N_PARALLEL)"
echo "║  Flash:   $FLASH_ATTN"
echo "║  KV Cache: K=$CACHE_TYPE_K V=$CACHE_TYPE_V"
echo "╠══════════════════════════════════════════════════╣"
echo "║  OpenClaw config:                               ║"
echo "║    base_url: http://${HOST}:${PORT}/v1           ║"
echo "║    model:    $(basename "$MODEL")"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# --- Launch ---
exec llama-server \
  --model "$MODEL" \
  --host "$HOST" \
  --port "$PORT" \
  --n-gpu-layers "$GPU_LAYERS" \
  --ctx-size "$CTX_TOTAL" \
  --parallel "$N_PARALLEL" \
  --cont-batching \
  --flash-attn "$FLASH_ATTN" \
  --cache-type-k "$CACHE_TYPE_K" \
  --cache-type-v "$CACHE_TYPE_V" \
  --metrics