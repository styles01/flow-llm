# Flow LLM Project Plan

**macOS LLM Orchestration for OpenClaw, Claude Code, and Codex (via AIRun)** — phased implementation plan.

---

## Phase 0: Foundation ✅

**Goal:** Project scaffolding, dev environment, backend validation.

| Task | Status |
|------|--------|
| Create monorepo structure (`server/`, `web/`) | ✅ Done |
| Initialize Python project (`server/pyproject.toml`) | ✅ Done |
| Initialize React project (`web/` with Vite + React + Tailwind) | ✅ Done |
| Test llama.cpp with Gemma 4 GGUF | ✅ Done — working with system prompts, tool calling, streaming |
| Create FastAPI skeleton (`server/main.py`) | ✅ Done — all management API endpoints |
| Create React skeleton | ✅ Done — all 6 pages with sidebar navigation |
| Validate Gemma 4 GGUF specifically | ✅ Done — template validator passes, tool calling works |

---

## Phase 1: Model Management ✅

**Goal:** Download, validate, and register models from HuggingFace.

| Task | Status |
|------|--------|
| HuggingFace Hub client module | ✅ Done — search, download, GGUF/MLX file listing |
| Template validator | ✅ Done — Jinja syntax, system role, tool calling, tokenizer completeness |
| Model registry (SQLite) | ✅ Done — CRUD operations, status tracking |
| Download endpoint | ✅ Done — `POST /api/models/download` |
| Register local GGUF | ✅ Done — `POST /api/register-local` |
| Connect external backend | ✅ Done — `POST /api/connect-external` |
| Scan local files | ✅ Done — `POST /api/models/scan` (GGUF + MLX directory detection) |
| Model CRUD endpoints | ✅ Done — list, detail, delete |
| Hardware detection | ✅ Done — chip type, unified memory, Metal support |

---

## Phase 2: Backend Lifecycle ✅

**Goal:** Start/stop backend servers, route inference requests.

| Task | Status |
|------|--------|
| Process manager (llama.cpp + MLX) | ✅ Done — start/stop subprocesses with port allocation |
| External process support | ✅ Done — connect to already-running backends |
| Auto-detect running backends | ✅ Done — scans common ports at startup, fuzzy-matches against DB |
| Unload kills external processes | ✅ Done — `_kill_port()` finds PID via lsof, SIGTERM → SIGKILL |
| Port assignment | ✅ Done — 8081-8099 (GGUF), 8100-8119 (MLX) |
| Load/unload endpoints | ✅ Done — with configurable ctx, flash attention, KV cache, parallel slots |
| Proxy router | ✅ Done — streaming SSE passthrough + non-streaming |
| `/v1/models` endpoint | ✅ Done — OpenAI-compatible model listing |
| Anthropic Messages API MVP | ✅ Done — `POST /v1/messages` adapter for AI-run / Claude Code with text, streaming SSE, and client tool support |
| Stale state cleanup on restart | ✅ Done — resets "running" models to "available" |
| Settings API | ✅ Done — GET/PUT `/api/settings` for default loading params |
| Settings persistence | ✅ Done — load defaults and auto-update flag saved to `settings.json` |
| Backend version/update API | ✅ Done — startup checks plus manual update endpoints |
| Live activity/log APIs | ✅ Done — downloads, logs, processing progress, per-slot activity |
| Legacy DB migration | ✅ Done — merges JAMES registry into Flow DB on startup |

---

## Phase 3: Frontend ✅

**Goal:** Working frontend with model management and dashboard.

| Task | Status |
|------|--------|
| Model Browser page | ✅ Done — HF search, local models, register GGUF, connect external |
| Monitor page | ✅ Done — real-time per-request tracking, token counter, request beams, WebSocket push |
| Chat Test page | ✅ Done — system prompt, streaming, tool calling, inline model loading |
| Logs page | ✅ Done — backend log viewer with per-model filter |
| Settings page | ✅ Done — loading defaults, models dir, backend versions/updates, hardware info, OpenClaw config |
| Telemetry page | ✅ Done — card-based request log with TTFT color-coding and token formatting |
| Load dialog | ✅ Done — context window, parallel slots, flash attention, KV cache, GPU layers, MLX presets (Qwen3.6 thinking/no-thinking), model type selector |

---

## Phase 4: Telemetry ✅

**Goal:** Performance visibility — TTFT, throughput, token counting.

| Task | Status |
|------|--------|
| TTFT measurement | ✅ Done — timer starts on proxy forward, stops on first token, displayed in seconds |
| Token counting | ✅ Done — input/output tokens from API response + estimated fallback (~4 chars/token) |
| Throughput calc | ✅ Done — tokens/sec from timing data |
| Telemetry storage | ✅ Done — SQLite table for request logs |
| Telemetry API | ✅ Done — `GET /api/telemetry` with model filtering |
| Telemetry frontend | ✅ Done — card-based layout with color-coded TTFT, formatted numbers |
| Per-request tracking | ✅ Done — request tracker with lifecycle stages (queued → prefilling → generating → sending → completed) |
| Real-time Monitor | ✅ Done — WebSocket push + polling fallback, request beams, token counter, idle waveform |

---

## Phase 5: GitHub Readiness ✅

**Goal:** Clean, installable, public-ready repo.

| Task | Status |
|------|--------|
| Expand `.gitignore` + `git rm --cached` tracked artifacts | ✅ Done |
| Remove hardcoded personal paths from tests | ✅ Done — replaced with generic paths |
| Write `setup.sh` bootstrap script | ✅ Done |
| Add `flow` CLI entry point to `pyproject.toml` | ✅ Done (already existed) |
| Polish README (generic paths, screenshot, one-liner install) | ✅ Done |
| Add LICENSE (MIT) | ✅ Done |
| Verify `pip install -e . && flow` works end-to-end | ⬜ Not started |
| Verify `npm run build` produces working frontend | ⬜ Not started |
| Verify frontend loads at `http://localhost:3377` | ⬜ Not started |
| No secrets/API keys/personal data in git history | ⬜ Not verified |
| Clean branch (`git status` shows nothing unexpected) | ⬜ Not verified |

---

## V2 Roadmap

Everything below is post-launch. See `docs/todo.md` for the full checklist.

### V2: Anthropic API Completeness
- `/v1/messages/count_tokens`, multimodal blocks, extended thinking, prompt caching, auth enforcement, batch API

### V2: Process Manager Robustness
- Crash detection, auto-restart with backoff, OOM detection, health-check loop

### V2: Polish & Hardening
- macOS menu bar app (PyObjC), .app bundle, launchd auto-start
- Graceful shutdown with state persistence, disk space management
- Telemetry charts, config export/import

### V2: Feature Parity (oMLX-inspired)
- One-click agent config (OpenClaw, Claude Code, Codex from dashboard)
- Built-in performance benchmark (PP/TG tok/s, prefix cache testing)
- HuggingFace model downloader in dashboard UI
- Vision-language model support
- **MLX auto tool-choice** — detect `supports_tools` from template validator, auto-enable `--enable-auto-tool-choice` at load time (fixed for Qwen 3.6, see `main.py` line 1018)
- Per-model settings (sampling params, chat template kwargs, TTL, alias)
- Built-in chat with conversation history and model switching
- Claude Code context scaling for smaller-context models

### V2: Frontend UX
- Error boundaries, toast notifications, keyboard shortcuts, responsive layout, accessibility

### V2: Security
- CORS restriction, API auth, rate limiting, path traversal protection

### V2: Testing
- Backend error mapping, streaming failures, download integration, process manager, E2E fidelity, long context benchmarks

### V2: Future
- Multi-machine routing, GGUF→MLX conversion, vLLM support, distributed inference, fine-tuning, HF API token config