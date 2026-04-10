#!/usr/bin/env bash
# start.sh — Launch JAMES (backend + frontend)
#
# Usage:
#   ./start.sh          # Start everything
#   ./start.sh backend  # Start backend only
#   ./start.sh frontend # Start frontend only
#   ./start.sh stop     # Stop everything

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""
PID_FILE="$ROOT_DIR/.james.pid"

start_backend() {
  echo "Starting JAMES backend on port 3377..."
  cd "$ROOT_DIR/server"
  python3 -m james.main &
  BACKEND_PID=$!
  echo "Backend PID: $BACKEND_PID"
}

start_frontend() {
  echo "Starting JAMES frontend..."
  cd "$ROOT_DIR/web"

  # Build if dist doesn't exist
  if [ ! -d "dist" ]; then
    echo "Building frontend (first time)..."
    npm run build
  fi

  # Start dev server with hot reload
  npm run dev &
  FRONTEND_PID=$!
  echo "Frontend PID: $FRONTEND_PID"
}

stop_all() {
  if [ -f "$PID_FILE" ]; then
    echo "Stopping JAMES..."
    while IFS=: read -r name pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo "Stopped $name (PID $pid)"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  else
    echo "No PID file found. JAMES may not be running."
  fi
}

case "${1:-all}" in
  backend)
    start_backend
    echo "backend:$BACKEND_PID" > "$PID_FILE"
    echo ""
    echo "Backend running at http://localhost:3377"
    echo "API docs at http://localhost:3377/docs"
    ;;
  frontend)
    start_frontend
    echo "frontend:$FRONTEND_PID" >> "$PID_FILE" 2>/dev/null || echo "frontend:$FRONTEND_PID" > "$PID_FILE"
    echo ""
    echo "Frontend running at http://localhost:5173"
    ;;
  stop)
    stop_all
    ;;
  all|"")
    start_backend
    sleep 2
    start_frontend
    echo "backend:$BACKEND_PID" > "$PID_FILE"
    echo "frontend:$FRONTEND_PID" >> "$PID_FILE"
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║            JAMES is running            ║"
    echo "╠════════════════════════════════════════╣"
    echo "║  Frontend:  http://localhost:5173      ║"
    echo "║  Backend:   http://localhost:3377      ║"
    echo "║  API docs:  http://localhost:3377/docs ║"
    echo "║  OpenClaw:  http://localhost:3377/v1   ║"
    echo "╠════════════════════════════════════════╣"
    echo "║  Stop:      ./start.sh stop            ║"
    echo "╚════════════════════════════════════════╝"
    # Keep script running
    wait
    ;;
  *)
    echo "Usage: $0 [backend|frontend|all|stop]"
    exit 1
    ;;
esac