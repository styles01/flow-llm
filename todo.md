# JAMES Todo List

Prioritized implementation checklist. Check off as completed.

---

## Phase 0: Foundation

- [ ] Create monorepo structure (`server/`, `web/`, `docs/`)
- [ ] Initialize Python project (`server/pyproject.toml`, virtualenv)
- [ ] Initialize React project (`web/` with Vite + React + Tailwind)
- [ ] Install llama.cpp server binary for macOS arm64
- [ ] Test llama.cpp with a GGUF model (e.g., Qwen 2.5 7B Q4)
  - [ ] System prompt works (`role: system`)
  - [ ] Tool calling works (`tools` parameter)
  - [ ] Streaming SSE works
  - [ ] `/v1/models` endpoint works
- [ ] Install mlx-openai-server (`pip install mlx-openai-server`)
- [ ] Test mlx-openai-server with an MLX model (e.g., mlx-community/Qwen2.5-7B-4bit)
  - [ ] System prompt works
  - [ ] Tool calling works
  - [ ] Streaming SSE works
- [ ] Validate Gemma 4 GGUF specifically
  - [ ] Download `bartowski/google-gemma-4-27b-it-GGUF` (Q4_K_M)
  - [ ] Test with llama.cpp — does it load? Does system prompt work?
  - [ ] Note: need llama.cpp runtime ≥ v2.10.0 for gemma4 architecture
- [ ] Create FastAPI skeleton (`server/main.py`)
  - [ ] Health endpoint (`GET /api/health`)
  - [ ] CORS middleware for frontend
  - [ ] Config loading (port, storage path)
- [ ] Create React skeleton
  - [ ] Layout with sidebar navigation
  - [ ] React Router setup
  - [ ] Tailwind base styles
  - [ ] TanStack Query provider

---

## Phase 1: Model Management

- [ ] HuggingFace Hub client module (`server/hf_client.py`)
  - [ ] Search models (`GET /api/hf/search?q=`)
  - [ ] Get model details (`GET /api/hf/model/{id}`)
  - [ ] List GGUF files for a model
  - [ ] List MLX conversions for a model
  - [ ] Download model with progress callback
  - [ ] Ensure `chat_template.jinja` is included in downloads
- [ ] Template validator module (`server/template_validator.py`)
  - [ ] Parse Jinja2 syntax (catch errors)
  - [ ] Check for `system` role handling
  - [ ] Check for `tools` parameter handling
  - [ ] Check `tokenizer_config.json` completeness
  - [ ] Test-render sample conversation
  - [ ] Return validation result + error details
- [ ] Model registry database (`server/models.py`)
  - [ ] SQLite schema (Model table)
  - [ ] CRUD operations
  - [ ] Status tracking (available → loading → running → available)
- [ ] Download endpoint (`POST /api/models/download`)
  - [ ] Accept HF model ID + quantization preference
  - [ ] Download to configured storage directory
  - [ ] Run template validator on download
  - [ ] Register in model registry
  - [ ] Return download progress via WebSocket
- [ ] Model list endpoint (`GET /api/models`)
- [ ] Model detail endpoint (`GET /api/models/{id}`)
- [ ] Model delete endpoint (`DELETE /api/models/{id}`)
- [ ] Hardware detection (`server/hardware.py`)
  - [ ] Detect Apple Silicon chip type (M4, M4 Pro, M4 Max)
  - [ ] Get unified memory size
  - [ ] Calculate available memory for models
  - [ ] Hardware info endpoint (`GET /api/hardware`)

---

## Phase 2: Backend Lifecycle

- [ ] Process manager module (`server/process_manager.py`)
  - [ ] Start llama.cpp server subprocess (GGUF backend)
  - [ ] Start mlx-openai-server subprocess (MLX backend)
  - [ ] Assign dynamic ports
  - [ ] Track process state (starting, running, crashed, stopped)
  - [ ] Kill process on unload
  - [ ] Handle port conflicts
- [ ] Health checker
  - [ ] Periodic GET to backend `/v1/models`
  - [ ] Mark as unhealthy after N failures
  - [ ] Auto-restart on crash (with backoff)
- [ ] Load endpoint (`POST /api/models/{id}/load`)
  - [ ] Check available memory (warn/ refuse if insufficient)
  - [ ] Determine backend type from model format
  - [ ] Build command-line args (chat template, context size, GPU layers)
  - [ ] Start process, wait for health check
  - [ ] Update registry status
  - [ ] Return assigned port
- [ ] Unload endpoint (`POST /api/models/{id}/unload`)
  - [ ] Stop backend process
  - [ ] Free port assignment
  - [ ] Update registry status
- [ ] Running models endpoint (`GET /api/models/running`)
  - [ ] List loaded models with status, memory usage, port
- [ ] Proxy router (`server/proxy.py`)
  - [ ] `POST /v1/chat/completions` — route by model name
  - [ ] Streaming passthrough (SSE)
  - [ ] Non-streaming forward
  - [ ] Error handling (backend down, model not found)
  - [ ] `GET /v1/models` — list loaded models in OpenAI format
  - [ ] Request logging (raw request + response stored)

---

## Phase 3: Frontend

- [ ] Model Browser page
  - [ ] HuggingFace search input
  - [ ] Search results grid (name, size, quantization options)
  - [ ] Download button with progress bar
  - [ ] Local models list (downloaded, available to load)
  - [ ] Disk usage indicator
- [ ] Running Models page
  - [ ] Card per loaded model (name, status, memory, port)
  - [ ] Start/stop button per model
  - [ ] Memory pressure bar (used/total unified memory)
  - [ ] Backend process logs viewer
- [ ] Chat Test page
  - [ ] System prompt editor (textarea)
  - [ ] Tool call builder (add tool definitions JSON)
  - [ ] Message input + streaming response display
  - [ ] Model selector dropdown (running models)
  - [ ] Raw request/response viewer (toggle)
- [ ] Settings page
  - [ ] Hardware profile display
  - [ ] Default storage path
  - [ ] HuggingFace API token input
  - [ ] Default context size
  - [ ] Export/import config
- [ ] WebSocket integration
  - [ ] Model status updates (loading → running → stopped)
  - [ ] Download progress
  - [ ] Telemetry stream (optional)
- [ ] Memory indicator component
  - [ ] Shows unified memory: used by models + system + available
  - [ ] Warns when loading a model would exceed available memory

---

## Phase 4: Telemetry

- [ ] Telemetry collector (`server/telemetry.py`)
  - [ ] TTFT measurement (time from proxy forward to first token)
  - [ ] Input token counting (from request)
  - [ ] Output token counting (from response or streaming token count)
  - [ ] Throughput calculation (tokens/sec)
  - [ ] Request log storage (SQLite)
- [ ] Telemetry API
  - [ ] `GET /api/telemetry` — recent request logs
  - [ ] `GET /api/telemetry/stats` — per-model aggregated stats
  - [ ] Time-range filtering
  - [ ] Model filtering
- [ ] Telemetry frontend
  - [ ] TTFT chart (line chart over time, per model)
  - [ ] Throughput chart (tokens/sec comparison)
  - [ ] Request log table (model, prompt summary, TTFT, throughput, timestamp)
  - [ ] Model comparison view (side-by-side stats)

---

## Phase 5: OpenClaw Integration & Validation

- [ ] OpenClaw config generator
  - [ ] Generate `openclaw.json` pointing to JAMES proxy
  - [ ] Include model tier definitions (primary, economy)
  - [ ] Handle `supportedParameters` for tool calling compat
- [ ] Validation test suite (`tests/`)
  - [ ] System prompt test: system role respected, no hidden injection
  - [ ] Tool calling test: function definitions work, responses parse correctly
  - [ ] Streaming test: SSE tokens arrive incrementally
  - [ ] Fidelity test: JAMES output == direct llama.cpp output (same model, same prompt)
- [ ] Long context benchmark
  - [ ] Measure TTFT and throughput at 1K, 4K, 8K, 16K context
  - [ ] Identify degradation point
- [ ] Gemma 4 specific test
  - [ ] System prompt works (no Jinja error)
  - [ ] Tool calling works
  - [ ] Reasoning mode (if `<|think|>` tag present)
- [ ] Dual hardware validation
  - [ ] Test on M4 Mac Mini 16GB (small models)
  - [ ] Test on M4 Max 48GB (large models)
  - [ ] Verify hardware profile detection
  - [ ] Verify memory warnings work correctly

---

## Phase 6: Polish & Hardening

- [ ] macOS launchd auto-start
  - [ ] Generate plist file for JAMES management server
  - [ ] Install/uninstall script
- [ ] Graceful shutdown
  - [ ] SIGTERM handler: unload models, stop backends, persist state
  - [ ] State persistence (reload running models on restart)
- [ ] Error recovery
  - [ ] Backend crash detection + auto-restart with backoff
  - [ ] Clear error messages in frontend
  - [ ] OOM detection + model unload suggestion
- [ ] Disk space management
  - [ ] Show total disk usage in settings
  - [ ] Warn when disk is >80% full
  - [ ] Model size estimates before download
- [ ] Config export/import
  - [ ] Export model list + settings as JSON
  - [ ] Import on second Mac (Mini ↔ Max)
- [ ] Documentation
  - [ ] README.md with quickstart
  - [ ] Setup guide (install backends, configure OpenClaw)
  - [ ] Troubleshooting guide (common errors + fixes)