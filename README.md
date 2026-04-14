<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/public/favicon.svg">
  <source media="(prefers-color-scheme: light)" srcset="web/public/favicon.svg">
  <img alt="Flow LLM" width="140" src="web/public/favicon.svg">
</picture>

# Flow LLM

**Local LLM gateway for Apple Silicon**

Run GGUF and MLX models locally. Proxy OpenAI & Anthropic API requests. Real-time monitoring. Built for coding agents.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Platform: Apple Silicon](https://img.shields.io/badge/platform-Apple%20Silicon-orange.svg)](https://support.apple.com/en-us/HT211814)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/jamesaita)

[Install](#quick-install) · [Features](#features) · [Quick Start](#quick-start) · [API](#api-endpoints) · [Architecture](docs/architecture.md)

</div>

---

Flow LLM is a local LLM gateway for macOS. It manages GGUF and MLX models on Apple Silicon, proxies OpenAI- and Anthropic-compatible API requests, and exposes real-time monitoring — so tools like **OpenClaw**, **[Hermes](https://github.com/nousresearch/hermes-agent)**, **Claude Code**, and **Codex** (via [AIRun](https://github.com/andisearch/airun)) can talk to local models without Ollama or LM Studio.

![Flow LLM Monitor](screenshots/flow-llm-monitor-page.png)

## Features

- **Real-time Monitor** — Per-request lifecycle tracking (queued → prefilling → generating → completed), odometer-style token counter, WebSocket push, idle waveform
- **OpenAI & Anthropic APIs** — Drop-in proxy for `/v1/chat/completions` and `/v1/messages`. Streaming and non-streaming, tool calling, system prompts
- **GGUF & MLX** — Run llama.cpp GGUF models or MLX models on Apple Silicon with sensible defaults (100K context, flash attention, q4_0 KV cache)
- **Agent-Ready** — Parallel slot support, Anthropic streaming SSE adapter, input token estimation fallback, stuck request pruning
- **Connect External** — Adopt an already-running llama-server without restarting it. Auto-detects model name
- **HuggingFace Browser** — Search and download models directly from the UI. Scan local directories for unregistered GGUF files
- **Telemetry** — TTFT, throughput, token counts per request. Card-based history with color-coded metrics
- **Template Validation** — Validates chat templates before loading (Jinja syntax, system role, tool calling)
- **Single Binary** — `pip install -e . && flow`. One process, one port (3377). Frontend bundled in the package

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/styles01/flow-llm/main/setup.sh | bash
```

Or clone and run:

```bash
git clone https://github.com/styles01/flow-llm.git
cd flow-llm && ./setup.sh
flow
```

Open **http://localhost:3377** — API and UI from a single process.

## Prerequisites

Flow requires **inference backends**. Install at least one:

```bash
# Required — GGUF models
brew install llama.cpp

# Optional — MLX models
pip install mlx-openai-server
```

## Quick Start

### 1. Start Flow

```bash
flow
```

### 2. Load a model

In the UI: **Models** → search HuggingFace, or **Connect Running Model** if you already have a llama-server.

Or via API:

```bash
curl -X POST http://localhost:3377/api/register-local \
  -H "Content-Type: application/json" \
  -d '{"gguf_path": "/path/to/model.gguf"}'
```

### 3. Point your agent

```json
{
  "models": {
    "providers": {
      "flow": {
        "baseUrl": "http://127.0.0.1:3377/v1",
        "apiKey": "flow-local",
        "api": "openai-completions"
      }
    }
  }
}
```

Flow also exposes `POST /v1/messages` for Claude Code and other Anthropic API tools.

## Model Loading Defaults

Flow ships with sensible defaults for Apple Silicon:

| Setting | Default | Why |
|---------|---------|-----|
| Context window | 100,000 tokens | Coding agents need long context |
| Flash attention | On | Critical for long context performance |
| KV cache | q4_0 | 75% memory savings, enables 100K on 48GB |
| GPU layers | -1 (all) | Metal acceleration |
| Parallel slots | 2 | Concurrent agent requests |
| Auto-update | On | Checks backend versions on startup |

Configurable in Settings page, persisted to `~/.flow/settings.json`.

## Development

```bash
cd server && pip install -e .
cd ../web && npm install && npm run dev
```

Frontend dev server at **http://localhost:5173** proxies API requests to the backend. Rebuild bundled frontend:

```bash
cd web && npm run build
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

## Connect External Backend

Flow can adopt an already-running backend without restarting it:

```bash
curl -X POST http://localhost:3377/api/connect-external \
  -H "Content-Type: application/json" \
  -d '{"base_url": "http://127.0.0.1:8081"}'
```

Auto-detects the model name. Unloading kills the backend process and frees memory.

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
| GET | `/api/hardware` | Hardware info (chip, memory, Metal) |
| GET | `/api/models` | List all registered models |
| GET | `/api/models/{id}` | Get model details |
| GET | `/api/models/running` | List running models |
| POST | `/api/models/{id}/load` | Load a model |
| POST | `/api/models/{id}/unload` | Unload a model |
| DELETE | `/api/models/{id}` | Delete a model |
| POST | `/api/models/download` | Download from HuggingFace |
| POST | `/api/models/scan` | Scan for unregistered GGUF files |
| POST | `/api/register-local` | Register a local GGUF file |
| POST | `/api/connect-external` | Connect to a running backend |
| GET | `/api/settings` | Get default loading settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/downloads` | Download progress |
| GET | `/api/hf/search?q=` | Search HuggingFace |
| GET | `/api/telemetry` | Request telemetry records |
| GET | `/api/requests` | Active request tracker |
| POST | `/api/requests/clear-stuck` | Clear stuck requests |
| GET | `/api/logs` | Backend logs |
| GET | `/api/model-activity` | Per-slot activity and metrics |
| GET | `/api/health` | Health check |

### OpenAI-Compatible Proxy

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/v1/chat/completions` | Chat completions (streaming + non-streaming) |
| POST | `/v1/messages` | Anthropic Messages API |
| GET | `/v1/models` | List available models |

### WebSocket

| Endpoint | Purpose |
|----------|---------|
| `/ws` | Real-time updates (request lifecycle, slot state, metrics, model events) |

## License

[MIT](LICENSE)