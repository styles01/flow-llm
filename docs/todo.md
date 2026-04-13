# Flow LLM Todo List

Prioritized implementation checklist.

---

## Completed ✅

### Phase 0: Foundation
- [x] Create monorepo structure (`server/`, `web/`)
- [x] Initialize Python project with FastAPI
- [x] Initialize React project with Vite + Tailwind + TanStack Query
- [x] Test llama.cpp with Gemma 4 GGUF (system prompts, tool calling, streaming)
- [x] Create FastAPI skeleton with health endpoint and CORS
- [x] Create React skeleton with sidebar navigation and 6 pages
- [x] Create launch scripts (`start.sh`, `.vscode/launch.json`, `gemma4.sh`)

### Phase 1: Model Management
- [x] HuggingFace Hub client (search, download, GGUF/MLX listing)
- [x] Template validator (Jinja syntax, system role, tool calling, tokenizer completeness)
- [x] Model registry (SQLite, CRUD, status tracking)
- [x] Model list/detail/delete endpoints
- [x] Download endpoint (`POST /api/models/download`)
- [x] Register local GGUF (`POST /api/register-local`)
- [x] Connect external backend (`POST /api/connect-external`)
- [x] Scan local files (`POST /api/models/scan` — GGUF + MLX directory detection)
- [x] Hardware detection (Apple Silicon, unified memory, Metal)

### Phase 2: Backend Lifecycle
- [x] Process manager (start/stop llama.cpp and mlx-openai-server)
- [x] External process support (adopt already-running backends)
- [x] Auto-detect running backends on startup (scan common ports)
- [x] Unload kills external processes (SIGTERM → SIGKILL via port)
- [x] Dynamic port allocation (8081-8099 GGUF, 8100-8119 MLX)
- [x] Load/unload endpoints with configurable parameters
- [x] Proxy router with streaming SSE passthrough
- [x] `/v1/models` OpenAI-compatible endpoint
- [x] Anthropic `POST /v1/messages` MVP adapter for AI-run / Claude Code
- [x] Anthropic request translation (`system`, `messages`, `tools`, `tool_choice`)
- [x] Anthropic response mapping (text + `tool_use`, usage, stop reasons)
- [x] Anthropic streaming SSE mapping (`message_start` → `message_stop`)
- [x] Anthropic `tool_use` / `tool_result` round-trip support
- [x] Anthropic-compatible error mapping for invalid models and backend failures
- [x] AI-run compatibility tests for invalid-model probe, streaming, tools, and auth header acceptance
- [x] Stale state cleanup on restart
- [x] Settings API (GET/PUT `/api/settings`)
- [x] Persist settings to disk (`settings.json`)
- [x] Backend version/update endpoints
- [x] Download/log/activity observability endpoints
- [x] Legacy DB migration (JAMES → Flow)

### Phase 3: Frontend
- [x] Models page (HF search, local models, register GGUF, connect external)
- [x] Running Models page (dashboard, memory bar, live slot/KV activity)
- [x] Chat Test page (system prompt, streaming, tool calling, inline load)
- [x] Logs page (backend stdout/stderr viewer)
- [x] Settings page (loading defaults, models dir, backend versions/updates, hardware info, OpenClaw config)
- [x] Telemetry page (request log table)
- [x] Load dialog (context window, parallel slots, flash attention, KV cache, GPU layers)

### Phase 4: Telemetry
- [x] TTFT measurement
- [x] Token counting
- [x] Throughput calculation
- [x] Telemetry storage (SQLite)
- [x] Telemetry API endpoint
- [x] Backend log capture + `/api/logs`
- [x] Processing progress endpoint
- [x] Live model activity endpoint

### Phase 5: OpenClaw Validation
- [x] System prompts work through the Flow proxy
- [x] Tool calling works through the Flow proxy
- [x] Streaming SSE works through the Flow proxy
- [x] OpenClaw config shown in Settings page
- [x] Anthropic Messages API bridge verified

---

## Remaining ⬜

### Phase 5: OpenClaw Validation (continued)
- [ ] Automated fidelity test suite (Flow output == direct llama.cpp output)
- [ ] Long context benchmark (1K, 4K, 16K, 100K)
- [ ] Dual hardware validation (Mini + Max)
- [ ] Reasoning mode test (Gemma 4 `<|think|>` tags)

### Phase 6: Anthropic API Completeness
- [ ] `/v1/messages/count_tokens` endpoint
- [ ] Multimodal content blocks (image, document)
- [ ] Extended thinking / `<thinking>` blocks passthrough
- [ ] Redacted thinking block support
- [ ] Server-tool use blocks
- [ ] Citations in content blocks
- [ ] Prompt caching (`cache_control` breakpoints)
- [ ] Anthropic-style auth enforcement (`x-api-key` validation)
- [ ] Anthropic version header validation (`anthropic-version`)
- [ ] Batch API (`/v1/messages/batches`)

### Phase 7: Process Manager Robustness
- [ ] Backend crash detection (periodic `is_running()` poll or `/health` probe)
- [ ] Auto-restart with exponential backoff on crash
- [ ] OOM detection (stderr pattern matching, `psutil` memory pressure)
- [ ] Model status → "error" on crash (currently stays "running" until server restart)
- [ ] Frontend notification on backend crash
- [ ] Graceful unload suggestion on OOM
- [ ] Health-check task for loaded backends (periodic GET to backend `/health`)

### Phase 8: Polish & Hardening
- [ ] macOS launchd auto-start plist
- [ ] Graceful shutdown with runtime state persistence (which models were loaded, params)
- [ ] Disk space management (show usage, warn at 80%)
- [ ] Telemetry charts (TTFT over time, throughput comparison, model comparison)
- [ ] Config export/import (share between machines)
- [ ] Replace polling with WebSocket for model/download status updates
- [ ] Full UX design review (visual hierarchy, type scale, interaction patterns)

### Phase 9: Frontend UX
- [ ] React error boundaries on all pages
- [ ] Loading/error states on all API calls (some are missing)
- [ ] Toast notifications for actions (load, unload, download complete)
- [ ] Keyboard shortcuts
- [ ] Responsive layout / mobile
- [ ] Accessibility audit (ARIA, focus management, contrast)

### Phase 10: Security
- [ ] CORS restriction (currently `allow_origins=["*"]`)
- [ ] API key or token auth on management endpoints
- [ ] Anthropic API key passthrough / validation
- [ ] Input sanitization on model IDs and file paths
- [ ] Rate limiting on proxy endpoints
- [ ] Path traversal protection on file operations

### Phase 11: Testing
- [ ] Backend error mapping tests (4xx/5xx from upstream)
- [ ] Streaming error / mid-stream failure tests
- [ ] Download flow integration tests
- [ ] Process manager start/stop/crash tests
- [ ] Frontend component tests
- [ ] End-to-end fidelity tests (Flow output vs direct llama.cpp output)
- [ ] Long context benchmark (1K, 4K, 16K, 100K)

### Bugs Fixed
- [x] Route ordering: `/api/models/running` before `/{model_id}` (404 fix)
- [x] `recommended_max_model_gb` negative (use total RAM not available)
- [x] Streaming proxy empty response (generator owns httpx client)
- [x] Chat only showing running models (show all registered models)
- [x] Unload not killing external processes (duplicate `stop_model` removed, `_kill_port` escalation)
- [x] Auto-detect model ID mismatch (fuzzy matching by ID/filename/name, create DB entry if needed)
- [x] Process manager logger not visible (added `print()` statements)
- [x] 422 on model load (removed redundant `model_id` from `ModelLoadRequest`)
- [x] HuggingFace search had no model card, file sizes, or download destination

### Known Issues
- [ ] `settings.ensure_dirs()` called twice in lifespan (harmless but redundant)
- [ ] Duplicate `import json` was in chat_completions proxy (moved to top-level)
- [ ] WebSocket `/ws` endpoint exists but frontend doesn't use it (still polling)
- [ ] MLX port range not auto-detected at startup (only GGUF ports scanned)
- [ ] `HuggingFaceClient(token=None)` — no way to configure HF API token
- [ ] No `models_dir` validation (accepts any path, even non-existent)
- [ ] Non-streaming Anthropic error response uses `_safe_parse_json_text` but streaming uses `_read_backend_error` — inconsistent pattern

### Design
- [x] Rebrand from the legacy name to Flow LLM
- [x] Teal + magenta synthwave color scheme
- [x] Bitcrushed waveform favicon and sidebar logo
- [x] Model search results show instruct/vision/mlx badges
- [x] Model detail card with description, tags, file breakdown, download destination
- [x] GGUF and MLX tabs in model detail view
- [x] "View on HuggingFace" link on model cards
- [x] File path shown under local model entries

### Future
- [ ] Multi-machine network routing
- [ ] Automatic GGUF → MLX conversion
- [ ] vLLM support (Linux/NVIDIA)
- [ ] Distributed inference
- [ ] Model fine-tuning
- [ ] HuggingFace API token configuration
- [ ] MLX port range auto-detect on startup