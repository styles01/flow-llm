# Flow LLM — Agent Onboarding Guide

**Read this first when starting a new session.**

---

## What Is This Project?

Flow (Just A Model Execution Server) is a local LLM gateway for running OpenClaw with local models on Apple Silicon (M4 Macs). It solves the core problem of existing tools (LM Studio, Ollama) breaking model fidelity — specifically system prompts, chat templates, and tool calling.

---

## Key Documents

| Document | Purpose | Read When |
|----------|---------|-----------|
| [architecture.md](architecture.md) | System design, component breakdown, data flows, API spec | Starting any implementation work |
| [project.md](project.md) | Phased plan with milestones and risk assessment | Planning a sprint or reviewing progress |
| [todo.md](todo.md) | Granular task checklist | Picking next task, checking what's done |
| [onboarding.md](onboarding.md) | This file — onboarding guide | Starting a new session |
| [github-readiness.md](github-readiness.md) | Checklist for public release | Preparing to share on GitHub |

---

## Current Status (What's Built)

### Backend (FastAPI) — Complete
- Full management API: models CRUD, load/unload, HuggingFace search/download
- OpenAI-compatible proxy with streaming SSE passthrough
- External backend connection (adopt already-running llama-server)
- Auto-detect running backends on startup (scans common ports)
- Unload kills external processes via port (SIGTERM → SIGKILL escalation)
- Template validator (Jinja syntax, system role, tool calling)
- Hardware detection (Apple Silicon, unified memory)
- SQLite model registry
- Settings API with persisted defaults (`settings.json`)
- Backend updater/version API (`/api/backend-versions`, `/api/check-updates`, `/api/update-backend/{backend}`)
- Observability APIs for downloads, logs, processing progress, and live model activity
- Auto-reset stale "running" statuses on restart

### Frontend (React SPA) — Complete
- **Models page**: HuggingFace search, local model list, register GGUF, connect external backend
- **Running page**: Dashboard with memory bar, per-model status, slot activity, queued turns, KV cache usage
- **Chat Test page**: System prompt editor, streaming responses, tool calling toggle, model loading from chat
- **Logs page**: Backend stdout/stderr viewer with per-model filter
- **Telemetry page**: Request log table
- **Settings page**: Persisted model loading defaults, backend versions, update controls, hardware info, OpenClaw config reference

### Infrastructure — Complete
- `start.sh` for launching backend + frontend
- `.vscode/launch.json` for debugging
- `gemma4.sh` for manual llama-server launch
- Port 3377 (avoids conflicts with other services)

---

## Critical Context

### The Core Problem
LM Studio and Ollama break OpenClaw by modifying prompts, overriding chat templates, and injecting hidden content. Flow is **transparent** — what OpenClaw sends is exactly what the model receives. No modification. No injection. No template override.

### The Architecture
```
OpenClaw → Flow Proxy (/v1/chat/completions) → Backend Server → Model
                    ↑
          Management Server (FastAPI, /api/*)
                    ↑
          Frontend (React SPA, http://localhost:5173)
```

- **GGUF models** → llama.cpp server (Metal GPU, mature, works with everything)
- **MLX models** → mlx-openai-server (faster when available, secondary choice)
- **External backends** → manually-started llama-server instances connected via `/api/connect-external`
- **Proxy** is thin and transparent — routes requests, collects telemetry, never modifies content
- **Template validator** catches Jinja errors and missing files before model loading

### Hardware
- M4 Max 48GB — runs 20B+ MoE models (Gemma 4 26B, Qwen 3 32B)
- M4 Mac Mini 16GB — runs 10B class models (independent, not networked)

### Tech Stack
- Backend: Python 3.11+, FastAPI, SQLAlchemy (SQLite), httpx, huggingface_hub, Jinja2
- Frontend: React 19, Vite, Tailwind CSS, TanStack Query
- Inference backends: llama.cpp server (C++ binary), mlx-openai-server (Python pip)

---

## Project Structure

```
Flow-LLM/
├── docs/
│   ├── architecture.md      # System design document
│   ├── project.md           # Phased project plan
│   ├── todo.md              # Implementation checklist
│   ├── onboarding.md        # This file
│   ├── changelog.md         # Development history
│   ├── openclaw-architecture-plan.md  # OpenClaw inference design
│   └── ux-redesign-plan.md  # UI redesign notes
├── start.sh                 # Launch script (backend + frontend)
├── server/                  # Python FastAPI backend
│   ├── flow_llm/
│   │   ├── main.py           # FastAPI app with all routes
│   │   ├── config.py        # Settings (port, defaults, paths)
│   │   ├── process_manager.py # Backend process lifecycle + external connections
│   │   ├── updater.py       # Backend version detection and update helpers
│   │   ├── hf_client.py     # HuggingFace Hub integration
│   │   ├── template_validator.py # Chat template validation
│   │   ├── database.py      # SQLAlchemy models + registry
│   │   └── hardware.py      # Hardware detection
│   └── pyproject.toml
├── web/                     # React frontend
│   ├── src/
│   │   ├── pages/           # Models, Running, Chat, Logs, Telemetry, Settings
│   │   ├── components/      # LoadDialog
│   │   ├── store/sessionStore.ts # Ephemeral route-persistent UI state
│   │   └── api/client.ts    # API client
│   └── vite.config.ts       # Proxy config for /api and /v1
└── .vscode/launch.json      # Debug configuration
```

---

## Key Design Decisions

1. **No prompt modification** — The proxy never adds, removes, or changes messages. This is the #1 design constraint.
2. **GGUF is primary** — llama.cpp server works with every model. MLX is secondary.
3. **No auto-conversion** — GGUF → MLX conversion is manual.
4. **Independent machines** — Each Mac runs its own Flow instance.
5. **Template validation before loading** — Catches Gemma 4-style Jinja errors before runtime.
6. **External backend support** — Can adopt already-running llama-server instances without restarting them. Auto-detects on startup.
7. **Streaming proxy owns its HTTP client** — The streaming proxy creates its own httpx.AsyncClient inside the async generator to avoid the client being closed prematurely.
8. **Route ordering matters** — FastAPI matches routes in order; `/api/models/running` must come before `/api/models/{model_id}` to avoid "running" being matched as a model ID.
9. **Port 3377** — Chosen to avoid conflicts with other developer services on common ports.
10. **100K context default** — OpenClaw is useless with small context windows. Default is 100K per slot × 2 parallel slots.
11. **Unload kills the process** — For external models, unload doesn't just disconnect — it finds the PID on the model's port and sends SIGTERM (escalating to SIGKILL), freeing memory.
12. **Auto-detect on startup** — Scans common ports for already-running backends and auto-connects them, so you don't have to manually register models every time.
13. **Settings persist across restarts** — Load defaults and the auto-update toggle are stored in `settings.json` in the data directory.
14. **Live activity is log/metrics driven** — The Running page combines slot state parsed from backend logs with llama.cpp `/metrics` output.

---

## Known Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Gemma 4 Jinja errors | `chat_template.jinja` not downloaded alongside model | Template validator checks for this file; HF client always downloads it |
| System prompt ignored | Backend overrides template | llama.cpp uses model's native template; no override |
| `/api/models/running` returns 404 | Route defined after `/{model_id}` catch-all | `running` route must be defined before `{model_id}` |
| `recommended_max_model_gb` negative | Formula used available RAM minus headroom | Fixed to use total RAM minus headroom |
| Streaming proxy returns nothing | httpx.AsyncClient closed before stream starts | Streaming generator now owns its own client, closed in `finally` |
| Context window shows 50K instead of 100K | llama-server divides `--ctx-size` by `--parallel` | Flow multiplies ctx_size × n_parallel internally |
| External model not visible in Chat | Chat only listed running models | Chat now lists all registered models, shows load button for available ones |
| Unload doesn't kill external models | Duplicate `stop_model` method — second version didn't call `_kill_port()` | Removed duplicate method, kept only version that kills processes |
| Auto-detect model ID mismatch | Detected name didn't match DB entry (e.g. Q4_K_S vs Q4_K_M) | Fuzzy matching by ID, filename, and name; creates DB entry if no match |
| Logger output not visible in uvicorn | Python logging not configured for process_manager | Added `print()` calls alongside `logger` for guaranteed visibility |
| Settings reset on restart | Defaults were only held in memory | Settings now persist to `settings.json` and are loaded during startup |

---

## OpenClaw Configuration

```json
{
  "models": {
    "providers": {
      "flow": {
        "baseUrl": "http://127.0.0.1:3377/v1",
        "apiKey": "flow-local",
        "api": "openai-completions"
      }
    }
  }
}
```

---

## Getting Started

1. Start backend: `cd server && flow`
2. Start frontend: `cd web && npm run dev`
3. Open http://localhost:5173
4. Connect an existing llama-server or register a local GGUF file
5. Optionally review backend versions and auto-update behavior in Settings
6. Point OpenClaw to `http://127.0.0.1:3377/v1`
