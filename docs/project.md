# Flow LLM Project Plan

**macOS LLM Orchestration** — phased implementation plan.

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
| Scan local files | ✅ Done — `POST /api/models/scan` |
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

---

## Phase 3: Frontend ✅

**Goal:** Working frontend with model management and dashboard.

| Task | Status |
|------|--------|
| Model Browser page | ✅ Done — HF search, local models, register GGUF, connect external |
| Running Models page | ✅ Done — dashboard with memory bar, status indicators, live activity |
| Chat Test page | ✅ Done — system prompt, streaming, tool calling, inline model loading |
| Logs page | ✅ Done — backend log viewer with per-model filter |
| Settings page | ✅ Done — loading defaults, backend versions/updates, hardware info, OpenClaw config |
| Telemetry page | ✅ Done — request log table |
| Load dialog | ✅ Done — context window, parallel slots, flash attention, KV cache, GPU layers |

---

## Phase 4: Telemetry (Partial)

**Goal:** Performance visibility — TTFT, throughput, token counting.

| Task | Status |
|------|--------|
| TTFT measurement | ✅ Done — timer starts on proxy forward, stops on first token |
| Token counting | ✅ Done — input/output tokens from API response |
| Throughput calc | ✅ Done — tokens/sec from timing data |
| Telemetry storage | ✅ Done — SQLite table for request logs |
| Telemetry API | ✅ Done — `GET /api/telemetry` with model filtering |
| Telemetry frontend | ✅ Done — request log table (charts not yet built) |

---

## Phase 5: OpenClaw Integration & Validation (In Progress)

**Goal:** Prove the system works end-to-end with OpenClaw.

| Task | Status |
|------|--------|
| OpenClaw config generator | ✅ Shown in Settings page |
| System prompt validation | ✅ Verified — Gemma 4 system prompts work through Flow |
| Tool calling validation | ✅ Verified — Gemma 4 tool calling works through Flow |
| Streaming test | ✅ Verified — SSE tokens arrive incrementally through proxy |
| Claude Code / AI-run bridge | ✅ Verified — Anthropic `POST /v1/messages` translates into the existing OpenAI proxy path |
| Fidelity test | ⬜ Not yet automated |
| Long context test | ⬜ Not yet tested at 100K |
| Dual hardware validation | ⬜ Not yet tested on Mini |

---

## Phase 6: Polish & Hardening (In Progress)

**Goal:** Production-ready for daily use.

| Task | Status |
|------|--------|
| Auto-start on login (macOS launchd) | ⬜ Not started |
| Graceful shutdown | ⬜ Partial — backend stops cleanly, settings persist, runtime state does not |
| Backend version management | ✅ Done — startup checks, persisted auto-update toggle, manual update actions |
| Error recovery (backend crash detection) | ⬜ Not started |
| Disk space management | ⬜ Not started |
| Config export/import | ⬜ Not started |
| Telemetry charts | ⬜ Not started (table only) |
