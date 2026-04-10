# JAMES — Just A Model Execution Server

Local LLM gateway for OpenClaw on Apple Silicon.

## Quick Start

### 1. Start the backend

```bash
cd ~/JAMES-LLM/server
pip install -e .
python3 -m james.main
```

Server starts on **http://localhost:3377**

### 2. Start the frontend (dev mode)

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

### 3. Register your existing model

Your Gemma 4 model is already on disk. In the UI, go to **Models → Register Existing Model** and enter:

```
/Volumes/James4TBSSD/llms/gemma4-26b-q4/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf
```

Or use the API:

```bash
curl -X POST http://localhost:3377/api/register-local \
  -H "Content-Type: application/json" \
  -d '{"gguf_path": "/Volumes/James4TBSSD/llms/gemma4-26b-q4/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf"}'
```

### 4. Configure OpenClaw

Point OpenClaw to JAMES:

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

## Architecture

See [architecture.md](architecture.md) for the full design.

## Key Files

| File | Purpose |
|------|---------|
| `gemma4.sh` | Launch script for Gemma 4 on llama-server |
| `server/james/main.py` | FastAPI app with all API routes |
| `server/james/process_manager.py` | Starts/stops llama.cpp and mlx-openai-server |
| `server/james/hf_client.py` | HuggingFace search and download |
| `server/james/template_validator.py` | Validates chat templates before loading |
| `server/james/database.py` | SQLite model registry |
| `server/james/hardware.py` | Apple Silicon detection |
| `web/src/pages/` | React frontend pages |
| `web/src/api/client.ts` | API client for frontend |
| `web/src/components/LoadDialog.tsx` | Model loading controls |

## Port Layout

| Port | Service |
|------|---------|
| 3377 | JAMES management server |
| 5173 | Frontend dev server (Vite) |
| 8081+ | llama.cpp backend processes |
| 8100+ | mlx-openai-server backend processes |