# Flow LLM Todo List

Prioritized implementation checklist.

---

## V1: Phase 5 — GitHub Readiness

### Git cleanup
- [x] Expand `.gitignore` (add `*.db`, `.vscode/`, `server/.pytest_cache/`, `dist/`)
- [ ] `git rm --cached` tracked artifacts (none found — already clean)

### Remove personal paths
- [x] Replace `/Volumes/James4TBSSD/llms/...` in `server/tests/test_model_registry_and_settings.py` with tmp_path-derived values
- [x] Replace `/Users/jameyaita` in `server/tests/test_anthropic_messages.py` with generic paths

### Bootstrap & packaging
- [x] Write `setup.sh` (check Python 3.11+, Node 18+, backends; pip install -e .; npm install && npm run build)
- [x] Add `flow` CLI entry point to `pyproject.toml` (already existed)
- [ ] Verify `pip install -e . && flow` starts the server
- [ ] Verify `npm run build` produces working `web/dist/`
- [ ] Verify frontend loads at `http://localhost:3377`

### Documentation
- [x] Polish README (screenshot, one-liner install, "What it does" intro, LICENSE link)
- [x] Add LICENSE (MIT)
- [x] Delete `docs/github-readiness.md` (redundant with project.md/todo.md)

---

## V1: Completed ✅

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

### Design
- [x] Rebrand from the legacy name to Flow LLM
- [x] Teal + magenta synthwave color scheme
- [x] Bitcrushed waveform favicon and sidebar logo
- [x] Model search results show instruct/vision/mlx badges
- [x] Model detail card with description, tags, file breakdown, download destination
- [x] GGUF and MLX tabs in model detail view
- [x] "View on HuggingFace" link on model cards
- [x] File path shown under local model entries
- [x] PWA manifest with dark-background icons

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
- [x] **Qwen 3.6 35B tool calls embedded in text** — `mlx_enable_auto_tool_choice` defaulted to `False` in `ModelLoadRequest`; auto-enabled when `model.supports_tools=True` (see `server/flow_llm/main.py` line 1018)

---

## V2 Roadmap

### 🔴 Critical — Blocking Real Use

- [x] **Per-model runtime config** — `_model_configs` in-memory dict, GET/PUT/DELETE endpoints, proxy injection of sampling defaults (`temperature`, `top_p`, `top_k`, `presence_penalty`) and `chat_template_kwargs` (`preserve_thinking`, `enable_thinking`); exposed on Monitor page per loaded model — see `docs/model-config-plan.md`
- [x] **Chat history persistence** — `sessionStore.ts` persists messages + selectedModel + systemPrompt to `localStorage`; hydrates on page reload.
- [ ] **Backend crash detection** — periodic health ping from server to loaded backends; mark model as "error" on failure; frontend notification
- [ ] **HuggingFace API token config** — Settings UI field + persisted to `settings.json`; required for gated models (Llama, Mistral, etc.)

### 🟠 High Impact — Power User Workflow

- [ ] **Remote access / mobile** — Settings toggle that starts a managed tunnel (Tailscale funnel or Cloudflare Tunnel via `cloudflared`); shows the public URL + QR code for easy phone access; no open ports required. Tailscale preferred for personal use; Cloudflare option for shareable URLs with auth.
- [ ] **Conversation persistence** — save chat history to SQLite; Conversations page with rename/delete/export
- [ ] **Model aliasing** — editable friendly name per model; shown in Chat/Monitor dropdowns instead of raw filenames
- [ ] **Telemetry charts** — TTFT trend line, throughput over time, model comparison heatmap (replace flat table)
- [ ] **Built-in benchmarking** — one-click PP/TG tok/s measurement, prefill cache testing (oMLX parity)
- [ ] **Disk space warnings** — check available space before download; warn at 80% full; show per-model disk usage

### Anthropic API Completeness
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

### Process Manager Robustness
- [ ] Backend crash detection (periodic `is_running()` poll or `/health` probe)
- [ ] Auto-restart with exponential backoff on crash
- [ ] OOM detection (stderr pattern matching, `psutil` memory pressure)
- [ ] Model status → "error" on crash (currently stays "running" until server restart)
- [ ] Frontend notification on backend crash
- [ ] Graceful unload suggestion on OOM
- [ ] Health-check task for loaded backends (periodic GET to backend `/health`)

### OpenClaw Validation
- [ ] Automated fidelity test suite (Flow output == direct llama.cpp output)
- [ ] Long context benchmark (1K, 4K, 16K, 100K)
- [ ] Dual hardware validation (Mini + Max)
- [x] Reasoning mode test — Qwen3.6 `<think>` blocks working via `--reasoning-parser qwen3_vl`
- [ ] Reasoning mode test — Gemma 4 `<|think|>` tags (llama.cpp)

### Polish & Hardening
- [ ] macOS menu bar app (PyObjC, start/stop/monitor server, auto-restart on crash, in-app auto-update)
- [ ] macOS .app bundle (auto-install to /Applications, launchd auto-start plist)
- [ ] Graceful shutdown with runtime state persistence (which models were loaded, params)
- [ ] Disk space management (show usage, warn at 80%)
- [ ] Telemetry charts (TTFT over time, throughput comparison, model comparison)
- [ ] Config export/import (share settings between machines)
- [ ] Full UX design review (visual hierarchy, type scale, interaction patterns)

### Feature Parity (oMLX comparison)
- [ ] One-click agent config (OpenClaw, Claude Code, Codex setup from dashboard)
- [ ] Built-in performance benchmark (one-click PP/TG tok/s measurement, prefix cache testing) — see 🟠 section
- [ ] Vision-language model support (multi-image chat, base64/URL/file inputs in Chat)
- [ ] Continuous batching / parallel request queuing visualization
- [ ] Claude Code context scaling (scale reported token counts for auto-compact timing)
- [ ] Per-model settings in dashboard (sampling params, chat template kwargs, TTL, model alias) — see 🔴 section
- [ ] Built-in chat with conversation history and model switching — see 🟠 section
- [ ] Model A/B testing — split-screen chat with same prompt sent to two models side-by-side

### Frontend UX
- [ ] React error boundaries on all pages
- [ ] Loading/error states on all API calls (some are missing)
- [ ] Toast notifications for actions (load, unload, download complete)
- [ ] Keyboard shortcuts
- [ ] Responsive layout / mobile
- [ ] Accessibility audit (ARIA, focus management, contrast)

### Security
- [ ] CORS restriction (currently `allow_origins=["*"]`)
- [ ] API key or token auth on management endpoints
- [ ] Anthropic API key passthrough / validation
- [ ] Input sanitization on model IDs and file paths
- [ ] Rate limiting on proxy endpoints
- [ ] Path traversal protection on file operations

### Testing
- [ ] Backend error mapping tests (4xx/5xx from upstream)
- [ ] Streaming error / mid-stream failure tests
- [ ] Download flow integration tests
- [ ] Process manager start/stop/crash tests
- [ ] Frontend component tests
- [ ] End-to-end fidelity tests (Flow output vs direct llama.cpp output)
- [ ] Long context benchmark (1K, 4K, 16K, 100K)

### Known Issues
- [x] `settings.ensure_dirs()` called twice in lifespan (harmless but redundant)
- [x] ~~WebSocket `/ws` endpoint exists but frontend doesn't use it~~ — now used for live slot/prefill updates on Monitor page
- [ ] MLX port range not auto-detected at startup (only GGUF ports scanned)
- [ ] `HuggingFaceClient(token=None)` — no way to configure HF API token (see 🔴 section)
- [ ] No `models_dir` validation (accepts any path, even non-existent)
- [ ] Non-streaming and streaming error parsing use inconsistent patterns
- [x] ~~Chat `max_tokens` hardcoded~~ — now user-configurable in Chat UI (8192 default)
- [ ] TTFT not recorded for thinking models when no `content` delta arrives before context exhausted
- [ ] Non-streaming proxy puts `<thinking>` in `content` not `reasoning_content` (streaming only splits correctly)
- [x] ~~`mlx_enable_auto_tool_choice` defaulted to `False` causing Qwen 3.6 tool calls to embed in text~~ — fixed in `main.py` line 1018: auto-enables when `model.supports_tools=True`
- [x] ~~Missing `--tool-call-parser` caused raw `<tool_call>` XML to stay in `reasoning_content` with no structured `tool_calls` JSON~~ — added `mlx_tool_call_parser` to `process_manager.py`, `main.py`, `LoadDialog.tsx`, `client.ts`, `ModelConfigDrawer.tsx`; auto-selects `qwen3`/`qwen3_coder` by default

### Future
- [ ] Multi-machine network routing
- [ ] Automatic GGUF → MLX conversion
- [ ] vLLM support (Linux/NVIDIA)
- [ ] Distributed inference
- [ ] Model fine-tuning
- [ ] HuggingFace API token configuration
- [ ] MLX port range auto-detect on startup