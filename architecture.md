# JAMES Architecture

**Just A Model Execution Server** — a local LLM gateway for OpenClaw on Apple Silicon.

---

## 1. Problem Statement

OpenClaw requires an OpenAI-compatible local LLM endpoint that preserves **system prompts**, **tool calling**, and **chat template fidelity**. Existing solutions break this:

| Solution | Problem |
|----------|---------|
| **LM Studio** | Rewrites chat templates, injects hidden prompts, breaks system prompts (Gemma 4 Jinja errors), bundles outdated llama.cpp runtimes |
| **Ollama** | High per-request overhead, abstraction hides model behavior, slow under long context |
| **vLLM** | Linux/NVIDIA only — no Apple Silicon support |
| **Raw llama.cpp** | Works but has no management UI, no telemetry, no model lifecycle |

The core issue: **the layer between the model and OpenClaw must be transparent**. It must not modify prompts, inject content, or override templates. It must download models with all their files intact (including `chat_template.jinja`), validate templates, and start backends with correct parameters.

---

## 2. Design Principles

### 2.1 Fidelity First
- Never modify system/user/assistant role content
- Never inject hidden prompts
- Use the model's native chat template — validate it, don't replace it
- Ensure `chat_template.jinja` is downloaded alongside `tokenizer_config.json`

### 2.2 Backend Direct
- Use llama.cpp server for GGUF (mature, Metal-accelerated, full tool calling support)
- Use mlx-openai-server for MLX (faster when available, same OpenAI API)
- No custom inference engine — leverage existing battle-tested backends
- Switch backends per model, not per request

### 2.3 Thin Proxy
- Single OpenAI-compatible endpoint for OpenClaw
- Routes to the correct backend based on model name
- Passes through requests and streams unmodified
- Collects telemetry (TTFT, tokens/sec, token counts) without adding latency
- Streaming proxy owns its own httpx client (avoids premature closure bug)
- Optional: can be bypassed — OpenClaw can talk directly to a backend

### 2.4 External Backend Support
- Can adopt already-running llama-server instances via `/api/connect-external`
- Auto-detects running backends on startup (scans common ports)
- No need to restart models — just point JAMES at the running backend
- Auto-detects model name from the backend's `/v1/models` endpoint
- Matches detected models against the database (by ID, filename, or name), creates entries if needed
- Strips `.gguf` extension from model names for database compatibility
- **Unloading kills the process** — for external models, JAMES finds the PID on the model's port via `lsof` and sends SIGTERM (escalating to SIGKILL if needed)

### 2.5 Frontend First
- React + Tailwind SPA for model management and testing
- Model browser with HuggingFace search and local GGUF registration
- Connect external running models without restart
- Running models dashboard with memory/status
- Chat test interface for validating system prompts and tool calls
- Telemetry view (TTFT, throughput, token counts)
- Settings page with model loading defaults

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (React SPA)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐  ┌──────┐ │
│  │  Models  │  │ Running  │  │  Chat    │  │Tele-  │  │Set-  │ │
│  │  (HF +  │  │ Models   │  │  Test    │  │metry  │  │tings  │ │
│  │  Local + │  │Dashboard │  │Interface │  │ View  │  │Config │ │
│  │  Connect)│  │          │  │          │  │       │  │       │ │
│  └──────────┘  └──────────┘  └──────────┘  └───────┘  └──────┘ │
└──────────────────────────┬───────────────────────────────────────┘
                           │ REST API + WebSocket
┌──────────────────────────┴───────────────────────────────────────┐
│                 Management Server (FastAPI, port 3377)           │
│                                                                   │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────────┐          │
│  │   Model    │ │   Server     │ │    Template         │          │
│  │  Manager   │ │  Lifecycle   │ │    Validator         │          │
│  │            │ │              │ │                      │          │
│  │ - Download │ │ - Start/stop │ │ - Jinja syntax chk  │          │
│  │ - Delete   │ │ - Health chk │ │ - Role support chk  │          │
│  │ - Register │ │ - External   │ │ - Tool call chk      │          │
│  │ - Search   │ │ - Auto-reset │ │                      │          │
│  └─────┬──────┘ └──────┬───────┘ └────────────────────┘          │
│        │               │                                          │
│  ┌─────┴──────┐ ┌──────┴───────┐ ┌────────────────────┐          │
│  │ HuggingFace│ │   Model      │ │    Telemetry       │          │
│  │ Hub Client │ │   Registry   │ │    Collector        │          │
│  │            │ │   (SQLite)   │ │                      │          │
│  │ - Search   │ │ - metadata   │ │ - TTFT             │          │
│  │ - Download │ │ - file paths │ │ - tokens/sec        │          │
│  │ - Auth     │ │ - backend    │ │ - token counts     │          │
│  │            │ │   type       │ │ - request logs      │          │
│  └────────────┘ └──────────────┘ └────────────────────┘          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐        │
│  │              Proxy Router (OpenAI-compatible)         │        │
│  │                                                      │        │
│  │  /v1/chat/completions  →  backend by model name      │        │
│  │  /v1/models            →  list loaded models          │        │
│  │                                                      │        │
│  │  - Streaming passthrough (SSE)                       │        │
│  │  - No prompt modification                            │        │
│  │  - Telemetry collection (TTFT timer starts on fwd)   │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────┬───────────────────────────────────────┘
                          │ Manages (start/stop/health)
           ┌──────────────┴──────────────┐
           ▼                              ▼
┌─────────────────────┐      ┌─────────────────────┐
│  llama.cpp server   │      │  mlx-openai-server  │
│  (GGUF backend)     │      │  (MLX backend)       │
│                     │      │                       │
│  - Metal GPU        │      │  - Apple MLX          │
│  - System prompts   │      │  - System prompts     │
│  - Tool calling     │      │  - Tool calling       │
│  - Streaming SSE    │      │  - Streaming SSE      │
│  - Chat templates   │      │  - Dynamic loading    │
└──────────┬──────────┘      └──────────┬──────────┘
           │                             │
           ▼                             ▼
      GGUF Models                  MLX Models
      (from HF Hub)               (from HF Hub)

           ▲
           │ Or: externally started
           │ (connected via /api/connect-external)
           └──── Already-running llama-server ────┘
```

### OpenClaw Connection

```
OpenClaw config:
  base_url: http://127.0.0.1:3377/v1    ← JAMES proxy endpoint
  model: gemma-4-26B-A4B-it-UD-Q4_K_M   ← model name in registry
```

OpenClaw sends standard OpenAI API requests. The proxy routes to whichever backend has that model loaded. Zero prompt modification. Zero template override.

---

## 4. Component Details

### 4.1 Frontend (React + Tailwind)

**Tech:** React 18, Tailwind CSS, Vite, TanStack Query

**Pages:**
| Page | Purpose |
|------|---------|
| Models | Search HuggingFace, browse local models, register GGUF, connect external backends, download |
| Running Models | See loaded models, memory usage, start/stop models |
| Chat Test | Send messages with system prompts, test tool calling, load models inline, streaming |
| Telemetry | TTFT, tokens/sec, request logs |
| Settings | Model loading defaults (context, flash attention, KV cache, parallel slots, GPU layers), hardware info, OpenClaw config |

**Key Features:**
- Connect to already-running backends without restart
- Register local GGUF files (e.g. on external SSD)
- Model loading with configurable context window, flash attention, KV cache quantization
- Memory pressure indicator
- Chat routes through JAMES proxy for telemetry

### 4.2 Management Server (FastAPI)

**Tech:** Python 3.12+, FastAPI, Pydantic v2, SQLAlchemy (SQLite), httpx

**Endpoints:**
```
# Management API (for frontend)
GET    /api/models                # List local models
GET    /api/models/running        # List running models (MUST be before /{id} route!)
GET    /api/models/{id}          # Model details
POST   /api/models/download      # Download from HF
DELETE /api/models/{id}          # Delete local model
POST   /api/models/{id}/load     # Load model (start backend)
POST   /api/models/{id}/unload   # Unload model (stop backend)
POST   /api/models/scan          # Scan for unregistered GGUF files
POST   /api/register-local        # Register existing GGUF file
POST   /api/connect-external      # Connect to already-running backend
GET    /api/settings              # Get default loading settings
PUT    /api/settings              # Update default loading settings
GET    /api/telemetry             # Get telemetry data
GET    /api/hardware              # Get hardware info
GET    /api/hf/search?q=          # Search HuggingFace
GET    /api/hf/model/{id}         # Get HF model details
GET    /api/health               # Health check

# Proxy (for OpenClaw)
POST   /v1/chat/completions      # Route to backend by model name
GET    /v1/models                # List available models
```

**Important:** `/api/models/running` must be defined before `/api/models/{model_id}` in FastAPI, otherwise "running" gets matched as a model ID.

**Model Registry (SQLite):**
```python
class Model:
    id: str               # e.g., "gemma-4-26B-A4B-it-UD-Q4_K_M"
    name: str             # display name (filename)
    backend: str          # "gguf" or "mlx"
    gguf_file: str | None # path to .gguf file
    mlx_path: str | None  # path to MLX model dir
    quantization: str     # e.g., "Q4_K_M"
    size_gb: float         # disk size
    template_valid: bool   # template validation passed
    supports_tools: bool   # template supports tool calling
    status: str           # "available", "loading", "running", "error"
    port: int | None       # backend server port
```

### 4.3 Process Manager

Manages backend processes and external connections:

- **BackendProcess**: Starts/stops llama.cpp or mlx-openai-server subprocesses
- **ExternalProcess**: Wraps an already-running backend, health-checks via HTTP
- **Auto-detect on startup**: Scans ports 8081+ for running llama-server instances, auto-connects them
- **Unload kills external processes**: Uses `lsof` to find the PID on the model's port, sends SIGTERM (escalates to SIGKILL after 2s)
- **Port allocation**: Dynamic ports in ranges 8081-8099 (GGUF) and 8100-8119 (MLX)
- **Stale state cleanup**: On startup, resets models stuck in "running" to "available"

### 4.4 Template Validator

This is the **critical component** that prevents LM Studio-style failures.

**Checks:**
1. **Jinja syntax** — Parse the template, catch syntax errors before loading
2. **System role support** — Verify the template handles `system` role messages
3. **Tool call support** — Verify the template handles `tools` parameter
4. **Tokenizer completeness** — Ensure `tokenizer_config.json` AND `chat_template.jinja` are both present
5. **Chat template rendering** — Test-render a sample conversation to catch runtime errors

### 4.5 Proxy Router

**Key properties:**
- **Transparent** — No prompt modification, no template injection, no hidden system messages
- **Streaming** — SSE passthrough for streaming completions
- **Low latency** — Async forwarding, no request buffering
- **Routing** — Model name → backend URL mapping from process manager
- **Telemetry** — TTFT timer (start on forward, stop on first token), token counting

**Critical implementation detail:** The streaming proxy must own its own `httpx.AsyncClient`. Creating the client with `async with` in the request handler causes the client to close before the streaming generator finishes, resulting in empty responses. The generator creates the client internally and closes it in a `finally` block.

### 4.6 Settings System

Default model loading parameters stored in memory (survives across the session, resets on restart):

| Setting | Default | Purpose |
|---------|---------|---------|
| `default_ctx_size` | 100000 | Context window per parallel slot |
| `default_flash_attn` | "on" | Flash attention (critical for long context) |
| `default_cache_type_k` | "q4_0" | KV cache key quantization |
| `default_cache_type_v` | "q4_0" | KV cache value quantization |
| `default_gpu_layers` | -1 | All layers on Metal GPU |
| `default_n_parallel` | 2 | Concurrent request slots |

Context size is multiplied by parallel slots internally (`ctx_size * n_parallel`) to compensate for llama-server dividing `--ctx-size` by `--parallel`.

---

## 5. Data Flows

### 5.1 Download and Load a Model

```
User clicks "Download" in frontend
  → Frontend → POST /api/models/download
  → Management Server → huggingface_hub.download()
  → Download all files (including chat_template.jinja)
  → Template Validator runs
  → Model registered in SQLite
  → Frontend shows model as "available"

User clicks "Load" (or OpenClaw requests model)
  → Frontend → POST /api/models/{id}/load
  → Management Server:
    1. Check available memory
    2. Determine backend type (GGUF → llama.cpp, MLX → mlx-openai-server)
    3. Assign port
    4. Start backend process with settings (ctx_size × n_parallel, flash attention, KV cache)
    5. Register in process manager
  → Frontend shows model as "running"
```

### 5.2 Auto-Detect and Connect External Backend

```
JAMES starts up
  → Lifespan handler scans ports 8081-8099 (GGUF) and 8100-8119 (MLX)
  → For each port, GET /v1/models to check for running backends
  → If found:
    1. Extract model name from response, strip .gguf extension
    2. Try matching against existing database entries (by ID, filename, or name)
    3. If match found: update status to "running" and set port
    4. If no match: create new DB entry with status "running"
    5. Register as ExternalProcess in process manager

User manually connects via /api/connect-external
  → Same flow as above but user provides the URL
  → Frontend shows Connect Running Model section
```

### 5.3 Unload a Model

```
User clicks "Unload" in frontend
  → Frontend → POST /api/models/{id}/unload
  → Management Server:
    1. Look up model in database, get its port
    2. Try process_manager.stop_model(model_id)
       - For managed processes: terminate subprocess, free port
       - For external processes: find PID on port via lsof, send SIGTERM
    3. If model not in process manager (state lost): kill port directly via _kill_port()
    4. _kill_port() uses lsof to find PIDs, sends SIGTERM, waits 2s, escalates to SIGKILL
    5. Update model status to "available", clear port/pid
  → Model process killed, memory freed
```

### 5.4 OpenClaw Inference Request

```
OpenClaw sends POST /v1/chat/completions
  → Proxy Router:
    1. Look up model in process manager
    2. Start TTFT timer
    3. Forward request to backend (no modification)
    4. If streaming: SSE passthrough with telemetry hooks
    5. If non-streaming: forward response, record telemetry
  → Backend (llama.cpp or mlx-openai-server):
    1. Render chat template with messages
    2. Run inference
    3. Stream tokens back
  → Telemetry recorded:
    - TTFT (time to first token)
    - Tokens per second
    - Input/output token counts
    - Model name and backend type
```

---

## 6. Hardware Profiles

| Profile | Device | RAM | Recommended Models |
|---------|--------|-----|---------------------|
| Mini | M4 Mac Mini | 16 GB | Gemma 4 4B, Qwen 3 8B, Phi-4 Mini |
| Max | M4 Max MacBook Pro | 48 GB | Gemma 4 26B, Qwen 3 32B, Llama 4 Scout |

The management server detects the hardware profile on startup and adjusts:
- Memory limits (warn if loading would exceed available RAM)
- Recommended max model size (total RAM - 20% headroom - 8GB system)
- Model recommendations (show models that fit)

---

## 7. Model Format Strategy

### GGUF (Primary — all models)
- **Source:** HuggingFace GGUF repos (e.g., `bartowski/google-gemma-4-27b-it-GGUF`)
- **Backend:** llama.cpp server with Metal GPU acceleration
- **Advantages:** Works with every model. Mature. Full chat template support. Tool calling.
- **When to use:** Default choice. Always works.

### MLX (Secondary — when available and faster)
- **Source:** HuggingFace MLX repos (e.g., `mlx-community/gemma-4-27b-it-4bit`)
- **Backend:** mlx-openai-server
- **Advantages:** 15-30% faster on Apple Silicon for supported models. Lower memory overhead.
- **When to use:** When an MLX conversion exists AND has been validated for template fidelity.
- **Current limitation:** Gemma 4 MLX doesn't exist yet. Use GGUF for Gemma 4.

---

## 8. Template Fidelity Guarantees

This is the core differentiator from LM Studio and Ollama. JAMES guarantees:

1. **No prompt injection** — The proxy never adds, removes, or modifies messages
2. **No template override** — The backend uses the model's native chat template
3. **No hidden system messages** — What OpenClaw sends is what the model receives
4. **Complete file downloads** — `chat_template.jinja` is always downloaded alongside `tokenizer_config.json`
5. **Pre-load validation** — Templates are syntax-checked before a model is loaded
6. **Transparent routing** — Users can see exactly what's sent to each backend

---

## 9. Key Dependencies

| Component | Package | Purpose |
|-----------|---------|---------|
| llama.cpp | `llama-server` binary | GGUF inference backend |
| mlx-openai-server | `mlx-openai-server` pip | MLX inference backend |
| FastAPI | `fastapi` | Management server |
| React | `react` + `vite` | Frontend SPA |
| Tailwind | `tailwindcss` | Frontend styling |
| TanStack Query | `@tanstack/react-query` | Frontend data fetching |
| huggingface_hub | `huggingface_hub` | Model downloading |
| Jinja2 | `jinja2` | Template validation |
| SQLAlchemy | `sqlalchemy` | Model registry (SQLite) |
| httpx | `httpx` | Async HTTP proxy |
| psutil | `psutil` | Hardware detection |

---

## 10. Bugs Fixed During Development

| Bug | Cause | Fix |
|-----|-------|-----|
| Context window 50K instead of 100K | llama-server divides `--ctx-size` by `--parallel` | Multiply ctx_size × n_parallel internally |
| `/api/models/running` returns 404 | Route defined after `/{model_id}` catch-all | Move `running` route before `{model_id}` |
| `recommended_max_model_gb` negative | Used available RAM minus headroom | Use total RAM minus headroom |
| Streaming proxy returns nothing | `httpx.AsyncClient` closed before stream starts | Generator owns its own client, closes in `finally` |
| Pydantic namespace warning | `model_id` field conflicts with protected namespace | Add `model_config = {"protected_namespaces": ()}` |
| Build system error | `setuptools.backends._legacy` not found | Changed build-backend to `setuptools.build_meta` |
| Unload doesn't kill external models | Duplicate `stop_model` method in ProcessManager — second version just unregistered without killing | Removed duplicate, kept only the version that calls `_kill_port()` |
| Auto-detect creates wrong model ID | Detected model name didn't match database entry (e.g. Q4_K_S vs Q4_K_M) | Auto-detect now fuzzy-matches by ID, filename, and name; creates DB entry if no match |
| Logger output not visible in uvicorn | Python logging not configured for process_manager module | Added `print()` statements alongside `logger` calls for guaranteed visibility |