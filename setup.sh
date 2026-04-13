#!/usr/bin/env bash
# setup.sh — Bootstrap Flow LLM
#
# Usage:
#   ./setup.sh          # Check deps, install, and build
#   curl -fsSL https://raw.githubusercontent.com/styles01/flow-llm/main/setup.sh | bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[Flow]${NC} $*"; }
warn()  { echo -e "${YELLOW}[Flow]${NC} $*"; }
error() { echo -e "${RED}[Flow]${NC} $*" >&2; }

die() { error "$@"; exit 1; }

# --- Check Python ---
check_python() {
  if command -v python3 &>/dev/null; then
    local version
    version=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    local major minor
    major=$(echo "$version" | cut -d. -f1)
    minor=$(echo "$version" | cut -d. -f2)
    if [ "$major" -lt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -lt 11 ]; }; then
      die "Python 3.11+ required (found $version). Install from https://python.org"
    fi
    info "Python $version found"
  else
    die "Python 3 not found. Install from https://python.org"
  fi
}

# --- Check Node ---
check_node() {
  if command -v node &>/dev/null; then
    local version
    version=$(node -v | sed 's/v//')
    local major
    major=$(echo "$version" | cut -d. -f1)
    if [ "$major" -lt 18 ]; then
      die "Node.js 18+ required (found $version). Install via https://nodejs.org or brew install node"
    fi
    info "Node.js $version found"
  else
    die "Node.js not found. Install via https://nodejs.org or: brew install node"
  fi
}

# --- Check inference backends ---
check_backends() {
  if command -v llama-server &>/dev/null; then
    info "llama-server found (GGUF backend ready)"
  else
    warn "llama-server not found — GGUF models won't work"
    warn "  Install with: brew install llama.cpp"
  fi

  if command -v mlx-openai-server &>/dev/null; then
    info "mlx-openai-server found (MLX backend ready)"
  else
    warn "mlx-openai-server not found — MLX models won't work (optional)"
    warn "  Install with: pip install mlx-openai-server"
  fi
}

# --- Install Python dependencies ---
install_python() {
  info "Installing Python dependencies..."
  cd "$(dirname "$0")/server"
  pip install -e . -q
  info "Python dependencies installed"
}

# --- Install and build frontend ---
install_frontend() {
  info "Building frontend and bundling into Python package..."
  "$(dirname "$0")/build_frontend.sh"
  info "Frontend bundled"
}

# --- Main ---
main() {
  echo ""
  echo "╔════════════════════════════════════════╗"
  echo "║      Flow LLM — Setup                  ║"
  echo "╚════════════════════════════════════════╝"
  echo ""

  check_python
  check_node
  check_backends
  install_frontend
  install_python

  echo ""
  echo "╔════════════════════════════════════════╗"
  echo "║      Setup complete!                   ║"
  echo "╠════════════════════════════════════════╣"
  echo "║  Start:  flow                          ║"
  echo "║  Open:   http://localhost:3377          ║"
  echo "║  Docs:   http://localhost:3377/docs      ║"
  echo "╚════════════════════════════════════════╝"
}

main "$@"