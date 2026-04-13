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
| Running Models page | ✅ Done — dashboard with memory bar, status indicators, live activity |
| Chat Test page | ✅ Done — system prompt, streaming, tool calling, inline model loading |
| Logs page | ✅ Done — backend log viewer with per-model filter |
| Settings page | ✅ Done — loading defaults, models dir, backend versions/updates, hardware info, OpenClaw config |
| Telemetry page | ✅ Done — request log table |
| Load dialog | ✅ Done — context window, parallel slots, flash attention, KV cache, GPU layers |

---

## Phase 4: Telemetry (Partial) ✅

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
| Reasoning mode test | ⬜ Not yet tested — Gemma 4 `<\|think\|>` tags |

---

## Phase 6: Anthropic API Completeness (Not Started)

**Goal:** Full Anthropic Messages API compatibility for Claude Code / AI-run.

| Task | Status |
|------|--------|
| `/v1/messages/count_tokens` endpoint | ⬜ Not started |
| Multimodal content blocks (image, document) | ⬜ Not started — adapter rejects with `invalid_request_error` |
| Extended thinking / `<thinking>` blocks | ⬜ Not started — adapter rejects with `invalid_request_error` |
| Redacted thinking blocks | ⬜ Not started — adapter rejects with `invalid_request_error` |
| Server-tool use blocks | ⬜ Not started — adapter rejects with `invalid_request_error` |
| Citations in content blocks | ⬜ Not started — adapter rejects with `invalid_request_error` |
| Prompt caching (`cache_control` breakpoints) | ⬜ Not started |
| Anthropic-style auth enforcement (`x-api-key`) | ⬜ Not started — headers accepted but not validated |
| Anthropic version header validation | ⬜ Not started |
| Batch API (`/v1/messages/batches`) | ⬜ Not started |
| Token counting from tokenizer (not just response usage) | ⬜ Not started |

---

## Phase 7: Process Manager Robustness (Not Started)

**Goal:** Crash detection, auto-recovery, health monitoring.

| Task | Status |
|------|--------|
| Backend crash detection (poll `is_running`) | ⬜ Not started — no health-check loop exists |
| Auto-restart with exponential backoff | ⬜ Not started |
| OOM detection (stderr pattern matching, memory pressure) | ⬜ Not started |
| Health-check endpoint on loaded backends | ⬜ Not started — no periodic `/health` probe |
| Model status → "error" on crash (currently stays "running") | ⬜ Not started — stale state only reset on server restart |
| Frontend notification on backend crash | ⬜ Not started |
| Graceful unload suggestion on OOM | ⬜ Not started |

---

## Phase 8: Polish & Hardening (In Progress)

**Goal:** Production-ready for daily use.

| Task | Status |
|------|--------|
| Auto-start on login (macOS launchd) | ⬜ Not started |
| Graceful shutdown with runtime state persistence | ⬜ Partial — backend stops cleanly, settings persist, runtime state does not |
| Backend version management | ✅ Done — startup checks, persisted auto-update toggle, manual update actions |
| Error recovery (backend crash detection) | ⬜ Not started (see Phase 7) |
| Disk space management | ⬜ Not started — no usage display or warning |
| Config export/import | ⬜ Not started |
| Telemetry charts | ⬜ Not started — table only, no graphs |
| WebSocket for real-time model/download status | ⬜ Skeleton exists — endpoint at `/ws`, frontend still polls |

---

## Phase 9: Frontend UX (Not Started)

**Goal:** Polish the UI beyond functional.

| Task | Status |
|------|--------|
| Error boundaries for React pages | ⬜ Not started — unhandled errors crash the page |
| Loading/error states on all API calls | ⬜ Partial — some calls lack loading indicators |
| Toast notifications for actions (load, unload, download) | ⬜ Not started — rely on refetch |
| Keyboard shortcuts | ⬜ Not started |
| Responsive layout | ⬜ Not started — fixed sidebar, no mobile layout |
| Full design review (visual hierarchy, type scale) | ⬜ Not started |
| Accessibility audit | ⬜ Not started |

---

## Phase 10: Security (Not Started)

**Goal:** Safe for network exposure.

| Task | Status |
|------|--------|
| CORS restriction (currently `allow_origins=["*"]`) | ⬜ Not started — wide open |
| API key or token auth on management endpoints | ⬜ Not started |
| Anthropic API key passthrough / validation | ⬜ Not started — headers accepted but ignored |
| Input sanitization on model IDs, file paths | ⬜ Partial — some endpoints accept arbitrary strings |
| Rate limiting | ⬜ Not started |
| Path traversal protection on file operations | ⬜ Not started |

---

## Phase 11: Testing (Partial)

**Goal:** Automated test coverage.

| Task | Status |
|------|--------|
| Anthropic adapter unit tests | ✅ Done — invalid model probe, non-streaming translation, streaming event order, tool round-trip, unsupported blocks, auth header acceptance |
| Model registry & settings tests | ✅ Done — settings persistence, legacy migration, local scan |
| OpenAI proxy tests | ✅ Done — passthrough unchanged |
| Backend error mapping tests | ⬜ Not started — 4xx/5xx from upstream not tested |
| Streaming error/timeout tests | ⬜ Not started — mid-stream failures not tested |
| Download flow integration tests | ⬜ Not started |
| Process manager start/stop tests | ⬜ Not started |
| Frontend component tests | ⬜ Not started |
| End-to-end fidelity tests (Flow vs direct llama.cpp) | ⬜ Not started |
| Long context benchmark (1K, 4K, 16K, 100K) | ⬜ Not started |

---

## Future

| Task | Notes |
|------|-------|
| Multi-machine network routing | Route to remote Macs/Linux boxes |
| Automatic GGUF → MLX conversion | Convert on download or on load |
| vLLM support (Linux/NVIDIA) | Backend-agnostic process manager already supports this |
| Distributed inference | Split model across machines |
| Model fine-tuning | MLX fine-tune integration |
| HuggingFace API token support | Currently `HuggingFaceClient(token=None)` |
| MLX port range auto-detect | Only GGUF ports scanned at startup |