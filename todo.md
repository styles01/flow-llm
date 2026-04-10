# JAMES Todo List

Prioritized implementation checklist.

---

## Completed ✅

### Phase 0: Foundation
- [x] Create monorepo structure (`server/`, `web/`)
- [x] Initialize Python project with FastAPI
- [x] Initialize React project with Vite + Tailwind + TanStack Query
- [x] Test llama.cpp with Gemma 4 GGUF (system prompts, tool calling, streaming)
- [x] Create FastAPI skeleton with health endpoint and CORS
- [x] Create React skeleton with sidebar navigation and 5 pages
- [x] Create launch scripts (`start.sh`, `.vscode/launch.json`, `gemma4.sh`)

### Phase 1: Model Management
- [x] HuggingFace Hub client (search, download, GGUF/MLX listing)
- [x] Template validator (Jinja syntax, system role, tool calling, tokenizer completeness)
- [x] Model registry (SQLite, CRUD, status tracking)
- [x] Model list/detail/delete endpoints
- [x] Download endpoint (`POST /api/models/download`)
- [x] Register local GGUF (`POST /api/register-local`)
- [x] Connect external backend (`POST /api/connect-external`)
- [x] Scan local files (`POST /api/models/scan`)
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
- [x] Stale state cleanup on restart
- [x] Settings API (GET/PUT `/api/settings`)

### Phase 3: Frontend
- [x] Models page (HF search, local models, register GGUF, connect external)
- [x] Running Models page (dashboard, memory bar, status)
- [x] Chat Test page (system prompt, streaming, tool calling, inline load)
- [x] Settings page (loading defaults, hardware info, OpenClaw config)
- [x] Telemetry page (request log table)
- [x] Load dialog (context window, parallel slots, flash attention, KV cache, GPU layers)

### Phase 4: Telemetry
- [x] TTFT measurement
- [x] Token counting
- [x] Throughput calculation
- [x] Telemetry storage (SQLite)
- [x] Telemetry API endpoint

### Phase 5: OpenClaw Validation
- [x] System prompts work through JAMES proxy
- [x] Tool calling works through JAMES proxy
- [x] Streaming SSE works through JAMES proxy
- [x] OpenClaw config shown in Settings page

---

## Remaining ⬜

### Phase 5: OpenClaw Validation (continued)
- [ ] Automated fidelity test suite (JAMES output == direct llama.cpp output)
- [ ] Long context benchmark (1K, 4K, 16K, 100K)
- [ ] Dual hardware validation (Mini + Max)
- [ ] Reasoning mode test (Gemma 4 `<|think|>` tags)

### Phase 6: Polish & Hardening
- [ ] macOS launchd auto-start plist
- [ ] Graceful shutdown with state persistence
- [ ] Backend crash detection + auto-restart with backoff
- [ ] Clear error messages in frontend for all failure modes
- [ ] OOM detection + model unload suggestion
- [ ] Disk space management (show usage, warn at 80%)
- [ ] Telemetry charts (TTFT over time, throughput comparison, model comparison)
- [ ] Config export/import (share between machines)
- [ ] WebSocket real-time updates (model status, download progress)

### Bugs Fixed
- [x] Route ordering: `/api/models/running` before `/{model_id}` (404 fix)
- [x] `recommended_max_model_gb` negative (use total RAM not available)
- [x] Streaming proxy empty response (generator owns httpx client)
- [x] Chat only showing running models (show all registered models)
- [x] Unload not killing external processes (duplicate `stop_model` removed, `_kill_port` escalation)
- [x] Auto-detect model ID mismatch (fuzzy matching by ID/filename/name, create DB entry if needed)
- [x] Process manager logger not visible (added `print()` statements)

### Future
- [ ] Multi-machine network routing
- [ ] Automatic GGUF → MLX conversion
- [ ] vLLM support (Linux/NVIDIA)
- [ ] Distributed inference
- [ ] Model fine-tuning
- [ ] Anthropic Messages API compatibility