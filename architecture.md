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
- Optional: can be bypassed — OpenClaw can talk directly to a backend

### 2.4 Dual Hardware
- M4 Mac Mini 16GB — 10B class models, lightweight tasks
- M4 Max 48GB — 20B+ MoE models, complex tasks
- Each machine runs independently (no network routing)
- Config syncs via shared profile (exportable JSON)

### 2.5 Frontend First
- React + Tailwind SPA for model management and testing
- Model browser with HuggingFace search
- Running models dashboard with memory/status
- Chat test interface for validating system prompts and tool calls
- Telemetry view (TTFT, throughput, token counts)

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Frontend (React SPA)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │  Model   │  │ Running  │  │  Chat    │  │Tele-  │ │
│  │ Browser  │  │ Models   │  │  Test    │  │metry  │ │
│  │ (HF Hub) │  │Dashboard │  │Interface │  │ View  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │ REST API + WebSocket
┌──────────────────────┴───────────────────────────────────┐
│               Management Server (FastAPI)                 │
│                                                           │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────────┐  │
│  │   Model    │ │   Server     │ │    Template         │  │
│  │  Manager   │ │  Lifecycle   │ │    Validator        │  │
│  │            │ │              │ │                      │  │
│  │ - Download │ │ - Start/stop │ │ - Jinja syntax chk  │  │
│  │ - Delete   │ │ - Health chk │ │ - Role support chk  │  │
│  │ - List     │ │ - Auto-restart│ │ - Tool call chk    │  │
│  │ - Search   │ │              │ │                      │  │
│  └─────┬──────┘ └──────┬───────┘ └────────────────────┘  │
│        │               │                                  │
│  ┌─────┴──────┐ ┌──────┴───────┐ ┌────────────────────┐  │
│  │ HuggingFace│ │   Model      │ │    Telemetry       │  │
│  │ Hub Client │ │   Registry   │ │    Collector        │  │
│  │            │ │              │ │                      │  │
│  │ - Search   │ │ - metadata   │ │ - TTFT             │  │
│  │ - Download │ │ - file paths │ │ - tokens/sec       │  │
│  │ - Auth     │ │ - backend    │ │ - token counts     │  │
│  │            │ │   type       │ │ - request logs     │  │
│  └────────────┘ └──────────────┘ └────────────────────┘  │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Proxy Router (OpenAI-compatible)         │ │
│  │                                                      │ │
│  │  /v1/chat/completions  →  backend by model name      │ │
│  │  /v1/models            →  list loaded models          │ │
│  │                                                      │ │
│  │  - Streaming passthrough (SSE)                       │ │
│  │  - No prompt modification                            │ │
│  │  - Telemetry collection (TTFT timer starts on fwd)   │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────┘
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
```

### OpenClaw Connection

```
OpenClaw config:
  base_url: http://localhost:8000/v1    ← JAMES proxy endpoint
  model: gemma-4-27b-it                 ← model name in registry
```

OpenClaw sends standard OpenAI API requests. The proxy routes to whichever backend has that model loaded. Zero prompt modification. Zero template override.

---

## 4. Component Details

### 4.1 Frontend (React + Tailwind)

**Tech:** React 18, Tailwind CSS, Vite, React Router, TanStack Query

**Pages:**
| Page | Purpose |
|------|---------|
| Model Browser | Search HuggingFace, browse local models, download new models, see disk usage |
| Running Models | See loaded models, memory usage per model, start/stop models, view logs |
| Chat Test | Send messages with system prompts, test tool calling, verify model fidelity |
| Telemetry | TTFT charts, tokens/sec, request logs, per-model performance comparison |
| Settings | Backend config, default ports, HuggingFace auth, hardware profile |

**Key Features:**
- Real-time status via WebSocket (model loading, inference progress)
- Download progress bars for HuggingFace models
- Memory pressure indicator (shows available vs. used unified memory)
- Hardware profile selector (Mini vs. Max) for model recommendations
- Chat test includes system prompt editor and tool call simulator

### 4.2 Management Server (FastAPI)

**Tech:** Python 3.12+, FastAPI, Pydantic v2, SQLAlchemy (SQLite), httpx

**Endpoints:**
```
# Management API (for frontend)
GET    /api/models/              # List local models
GET    /api/models/{id}          # Model details
POST   /api/models/download     # Download from HF
DELETE /api/models/{id}          # Delete local model
POST   /api/models/{id}/load    # Load model (start backend)
POST   /api/models/{id}/unload  # Unload model (stop backend)
GET    /api/models/running      # List running models with status
GET    /api/telemetry           # Get telemetry data
GET    /api/hardware            # Get hardware info (memory, GPU)

# HuggingFace search
GET    /api/hf/search?q=        # Search HF Hub
GET    /api/hf/model/{id}       # Get HF model details

# Proxy (for OpenClaw)
POST   /v1/chat/completions     # Route to appropriate backend
GET    /v1/models               # List available models
```

**Model Registry (SQLite):**
```python
class Model:
    id: str               # e.g., "google/gemma-4-27b-it"
    name: str             # display name
    backend: str          # "gguf" or "mlx"
    gguf_file: str | None # path to .gguf file
    mlx_path: str | None  # path to MLX model dir
    quantization: str     # e.g., "Q4_K_M", "4bit"
    size_gb: float        # disk size
    memory_gb: float      # estimated RAM usage
    chat_template: str    # validated template content
    supports_tools: bool  # whether template supports tool calling
    status: str           # "available", "loading", "running", "error"
    port: int | None      # backend server port
```

### 4.3 Template Validator

This is the **critical component** that prevents LM Studio-style failures.

**Checks:**
1. **Jinja syntax** — Parse the template, catch syntax errors before loading
2. **System role support** — Verify the template handles `system` role messages
3. **Tool call support** — Verify the template handles `tools` parameter
4. **Tokenizer completeness** — Ensure `tokenizer_config.json` AND `chat_template.jinja` are both present (this is the exact Gemma 4 bug — the template is in a separate file)
5. **Chat template rendering** — Test-render a sample conversation to catch runtime errors

**Flow:**
```
Download model → Validate template → Pass: available for loading
                                  → Fail: show error details, suggest fix
```

### 4.4 Proxy Router

**Key properties:**
- **Transparent** — No prompt modification, no template injection, no hidden system messages
- **Streaming** — SSE passthrough for streaming completions
- **Low latency** — Async forwarding, no request buffering
- **Routing** — Model name → backend URL mapping from registry
- **Telemetry** — TTFT timer (start on forward, stop on first token), token counting

**Implementation:**
```python
@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    model = request.model
    backend_url = registry.get_backend_url(model)
    if not backend_url:
        raise HTTPException(404, f"Model {model} not loaded")

    start_time = time.monotonic()

    if request.stream:
        return StreamingResponse(
            stream_with_telemetry(backend_url, request, start_time),
            media_type="text/event-stream"
        )
    else:
        response = await forward_request(backend_url, request)
        record_telemetry(request, response, start_time)
        return response
```

### 4.5 Backend Processes

The management server starts and manages backend processes:

**llama.cpp server (GGUF):**
```bash
llama-server \
  --model /path/to/model.gguf \
  --host 127.0.0.1 \
  --port {assigned_port} \
  --n-gpu-layers 99 \
  --ctx-size {context_size} \
  --chat-template {template_name_or_path} \
  --parallel 1
```

**mlx-openai-server (MLX):**
```bash
mlx-openai-server launch \
  --model-path {hf_model_id_or_local_path} \
  --model-type lm \
  --host 127.0.0.1 \
  --port {assigned_port}
```

Each model gets its own port. The management server tracks port assignments and health.

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
    4. Start backend process
    5. Wait for health check
    6. Register in routing table
  → Frontend shows model as "running"
```

### 5.2 OpenClaw Inference Request

```
OpenClaw sends POST /v1/chat/completions
  → Proxy Router:
    1. Look up model in routing table
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
| Max | M4 Max MacBook Pro | 48 GB | Gemma 4 27B, Qwen 3 32B, Llama 4 Scout |

The management server detects the hardware profile on startup and adjusts:
- Memory limits (warn if loading would exceed available RAM)
- Model recommendations (show models that fit)
- Backend defaults (MLX preferred on Max, GGUF fallback on Mini for wider compatibility)

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

### No automatic conversion
- GGUF → MLX conversion is not automated. The user can manually convert if desired.
- The system will prefer GGUF by default and use MLX only when a pre-converted model is available and validated.

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

## 9. Security Considerations

- JAMES runs locally only (bind to 127.0.0.1)
- No external network access required after model download
- HuggingFace API token stored in OS keychain (not in config files)
- Model files stored in user-specified directory with standard permissions
- OpenClaw API key is `james-local` (no real auth needed for local-only)

---

## 10. Key Dependencies

| Component | Package | Purpose |
|-----------|---------|---------|
| llama.cpp | `llama-server` binary | GGUF inference backend |
| mlx-openai-server | `mlx-openai-server` pip | MLX inference backend |
| FastAPI | `fastapi` | Management server |
| React | `react` + `vite` | Frontend SPA |
| Tailwind | `tailwindcss` | Frontend styling |
| huggingface_hub | `huggingface_hub` | Model downloading |
| Jinja2 | `jinja2` | Template validation |
| SQLAlchemy | `sqlalchemy` | Model registry (SQLite) |
| httpx | `httpx` | Async HTTP proxy |
| psutil | `psutil` | Hardware detection |