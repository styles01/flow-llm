# Flow LLM — macOS LLM Orchestration

Local LLM gateway for OpenClaw on Apple Silicon.

## Prerequisites

Flow LLM requires **inference backends** to run models. Install at least one:

### llama.cpp (required for GGUF models)

```bash
# Install via Homebrew
brew install llama.cpp

# Or build from source
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp && mkdir build && cd build
cmake .. -DGGML_METAL=on && cmake --build . --config Release
```

This provides the `llama-server` command used to run GGUF models with Metal GPU acceleration.

### mlx-openai-server (optional, for MLX models)

```bash
pip install mlx-openai-server
```

This provides the `mlx-openai-server` command for running MLX-format models. MLX models can be faster on Apple Silicon but have fewer compatible models than GGUF.

### Verify installations

```bash
llama-server --version    # Should print llama.cpp version
mlx-openai-server --help  # Should print help (optional, skip if not using MLX)
```

## Quick Start

### 1. Install Python dependencies

```bash
cd ~/JAMES-LLM/server
pip install -e .
```

### 2. Start the backend

```bash
python3 -m james.main
```

Server starts on **http://localhost:3377**

### 3. Start the frontend (dev mode)

```bash
cd ~/JAMES-LLM/web
npm install
npm run dev
```

Frontend at **http://localhost:5173** (proxies API to backend)

Or build and serve from the backend:

```bash
cd ~/JAMES-LLM/web && npm run build
cd ~/JAMES-LLM/server && python3 -m james.main
# Everything at http://localhost:3377
```

### 4. Connect a running model

If you already have a llama-server running (e.g. from `gemma4.sh`):

1. Open Flow UI → **Models** → **Connect Running Model**
2. Enter the URL (e.g. `http://127.0.0.1:8081`)
3. Click **Connect** — Flow auto-detects the model name

Or register a local GGUF file and load through Flow:

```bash
curl -X POST http://localhost:3377/api/register-local \
  -H "Content-Type: application/json" \
  -d '{"gguf_path": "/Volumes/James4TBSSD/llms/gemma4-26b-q4/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf"}'
```

Then load it in the UI with your preferred settings (100K context, flash attention, q4_0 KV cache).

### 5. Configure OpenClaw

Point OpenClaw to Flow:

```json
{
  "models": {
    "providers": {
      "james": {
        "baseUrl": "http://127.0.0.1:3377/v1",
        "apiKey": "james-local",
        "api": "openai-completions"
      }
    }
  }
}
```

## Dependencies

### Required

| Dependency | Purpose | Install |
|-----------|---------|---------|
| Python 3.11+ | Runtime | System |
| llama.cpp | GGUF inference backend | `brew install llama.cpp` |
| Node.js 18+ | Frontend build | `brew install node` |

### Python packages (installed via `pip install -e .`)

| Package | Purpose |
|---------|---------|
| fastapi | Management server and API |
| uvicorn | ASGI server |
| httpx | Async HTTP proxy |
| sqlalchemy | Model registry (SQLite) |
| huggingface-hub | Model search and download |
| jinja2 | Chat template validation |
| psutil | Hardware detection |
| pydantic | Request/response models |
| websockets | Real-time updates |

### Optional

| Dependency | Purpose | Install |
|-----------|---------|---------|
| mlx-openai-server | MLX inference backend | `pip install mlx-openai-server` |

## Architecture

See [architecture.md](architecture.md) for the full design.

## Key Files

| File | Purpose |
|------|---------|
| `server/james/main.py` | FastAPI app with all API routes |
| `server/james/process_manager.py` | Starts/stops llama.cpp and mlx-openai-server; also manages external processes |
| `server/james/hf_client.py` | HuggingFace search and download |
| `server/james/template_validator.py` | Validates chat templates before loading |
| `server/james/database.py` | SQLite model registry |
| `server/james/hardware.py` | Apple Silicon detection |
| `server/james/config.py` | Default settings (port 3377, 100K context, flash attention, q4_0 KV cache) |
| `web/src/pages/Models.tsx` | Model management with HF search, local registration, connect external |
| `web/src/pages/Chat.tsx` | Chat test with system prompt editor, streaming SSE, tool calling |
| `web/src/pages/Running.tsx` | Running models dashboard with memory bar |
| `web/src/pages/Settings.tsx` | Model loading defaults, hardware info, OpenClaw config |
| `web/src/pages/Telemetry.tsx` | Request log table |
| `web/src/components/LoadDialog.tsx` | Model loading controls (context, parallel slots, flash attention, KV cache) |
| `web/src/api/client.ts` | API client for frontend |
| `gemma4.sh` | Launch script for Gemma 4 on llama-server |
| `start.sh` | Start backend + frontend |
| `.vscode/launch.json` | VS Code debug configuration |

## Port Layout

| Port | Service |
|------|---------|
| 3377 | Flow management server |
| 5173 | Frontend dev server (Vite) |
| 8081+ | llama.cpp backend processes |
| 8100+ | mlx-openai-server backend processes |

## API Endpoints

### Management API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/hardware` | Hardware info (chip, memory, Metal support) |
| GET | `/api/models` | List all registered models |
| GET | `/api/models/{id}` | Get model details |
| GET | `/api/models/running` | List running models with live status |
| POST | `/api/models/{id}/load` | Load a model (start backend process) |
| POST | `/api/models/{id}/unload` | Unload a model (stop backend process) |
| DELETE | `/api/models/{id}` | Delete a model from disk and registry |
| POST | `/api/models/download` | Download from HuggingFace |
| POST | `/api/models/scan` | Scan local files for unregistered GGUF |
| POST | `/api/register-local` | Register an existing GGUF file |
| POST | `/api/connect-external` | Connect to an already-running backend |
| GET | `/api/settings` | Get default model loading settings |
| PUT | `/api/settings` | Update default settings |
| GET | `/api/hf/search?q=` | Search HuggingFace models |
| GET | `/api/hf/model/{id}` | Get HuggingFace model details |
| GET | `/api/telemetry` | Get telemetry records |
| GET | `/api/health` | Health check |

### OpenAI-Compatible Proxy

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/v1/chat/completions` | Route to backend by model name (streaming + non-streaming) |
| GET | `/v1/models` | List available models |

## Connect External Backend

Flow can connect to an already-running backend (like a manually-started llama-server) without restarting it:

```bash
curl -X POST http://localhost:3377/api/connect-external \
  -H "Content-Type: application/json" \
  -d '{"base_url": "http://127.0.0.1:8081"}'
```

This auto-detects the model name from the backend and registers it as running. The proxy will route requests to it. Unloading an external model kills the backend process and frees memory.

## Model Loading Defaults

Flow ships with sensible defaults for Apple Silicon:

- **Context window**: 100,000 tokens (OpenClaw needs large context)
- **Flash attention**: On (critical for long context)
- **KV cache**: q4_0 quantization (75% memory savings, enables 100K context on 48GB)
- **GPU layers**: -1 (all layers on Metal)
- **Parallel slots**: 2 (for concurrent agent requests)

These can be changed in the Settings page and are used as defaults in the Load dialog.