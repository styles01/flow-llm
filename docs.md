# JAMES — Agent Onboarding Guide

**Read this first when starting a new session.**

---

## What Is This Project?

JAMES (Just A Model Execution Server) is a local LLM gateway for running OpenClaw with local models on Apple Silicon (M4 Macs). It solves the core problem of existing tools (LM Studio, Ollama) breaking model fidelity — specifically system prompts, chat templates, and tool calling.

---

## Key Documents

| Document | Purpose | Read When |
|----------|---------|-----------|
| `architecture.md` | System design, component breakdown, data flows, API spec | Starting any implementation work |
| `project.md` | Phased plan with milestones and risk assessment | Planning a sprint or reviewing progress |
| `todo.md` | Granular task checklist | Picking next task, checking what's done |
| `docs.md` | This file — onboarding guide | Starting a new session |

---

## Critical Context

### The Core Problem
LM Studio and Ollama break OpenClaw by modifying prompts, overriding chat templates, and injecting hidden content. JAMES is **transparent** — what OpenClaw sends is exactly what the model receives. No modification. No injection. No template override.

### The Architecture
```
OpenClaw → JAMES Proxy → Backend Server → Model
              ↑
        Management Server (FastAPI)
              ↑
        Frontend (React SPA)
```

- **GGUF models** → llama.cpp server (Metal GPU, mature, works with everything)
- **MLX models** → mlx-openai-server (faster when available, secondary choice)
- **Proxy** is thin and transparent — routes requests, collects telemetry, never modifies content
- **Template validator** catches Jinja errors and missing files before model loading

### Hardware
- M4 Mac Mini 16GB — runs 10B class models (Qwen 3 8B, Gemma 4 4B)
- M4 Max 48GB — runs 20B+ MoE models (Gemma 4 27B, Qwen 3 32B)
- Each machine runs independently (no network routing)

### Tech Stack
- Backend: Python 3.12+, FastAPI, SQLAlchemy (SQLite), httpx, huggingface_hub, Jinja2
- Frontend: React 18, Vite, Tailwind CSS, TanStack Query
- Inference backends: llama.cpp server (C++ binary), mlx-openai-server (Python pip)

---

## Project Structure

```
JAMES-LLM/
├── architecture.md          # System design document
├── project.md               # Phased project plan
├── todo.md                  # Implementation checklist
├── docs.md                  # This file
├── open_claw_local_inference_architecture_plan.md  # Original ChatGPT proposal (reference)
├── server/                  # Python FastAPI backend
│   ├── main.py              # App entry point
│   ├── hf_client.py         # HuggingFace Hub integration
│   ├── template_validator.py # Chat template validation
│   ├── process_manager.py    # Backend process lifecycle
│   ├── proxy.py             # OpenAI-compatible proxy router
│   ├── telemetry.py         # Performance measurement
│   ├── hardware.py          # Hardware detection
│   └── models.py            # SQLAlchemy models + registry
├── web/                     # React frontend
│   ├── src/
│   │   ├── pages/           # Model Browser, Running, Chat Test, Telemetry, Settings
│   │   ├── components/      # Reusable UI components
│   │   └── api/             # API client hooks
│   └── ...
└── tests/                   # Validation test suite
```

---

## Key Design Decisions

1. **No prompt modification** — The proxy never adds, removes, or changes messages. This is the #1 design constraint.
2. **GGUF is primary** — llama.cpp server works with every model. MLX is secondary and only used when a validated conversion exists.
3. **No auto-conversion** — GGUF → MLX conversion is manual. The user decides when to use which format.
4. **Independent machines** — No network routing between Macs. Each runs its own JAMES instance.
5. **Template validation before loading** — Catches Gemma 4-style Jinja errors before they cause runtime failures.
6. **SQLite for registry** — No external database dependency. Simple, local, reliable.

---

## Known Issues in the Wild

| Issue | Cause | How JAMES Handles It |
|-------|-------|----------------------|
| Gemma 4 Jinja errors | `chat_template.jinja` not downloaded alongside model | Template validator checks for this file; HF client always downloads it |
| System prompt ignored | Backend overrides template | llama.cpp uses model's native template via `--chat-template`; no override |
| Tool calling broken | Template doesn't support tools | Template validator checks for tools support; marks models accordingly |
| LM Studio hidden injection | LM Studio adds system messages | JAMES proxy is transparent — zero injection |
| Ollama overhead | Abstraction layer adds latency | JAMES talks directly to llama.cpp / mlx-openai-server |

---

## Getting Started (for Implementation)

1. Read `architecture.md` for the full design
2. Check `todo.md` for what's been done and what's next
3. Check `project.md` for current phase
4. Install dependencies: `server/` needs Python 3.12+, `web/` needs Node 20+
5. Install backends: llama.cpp binary + `pip install mlx-openai-server`

---

## OpenClaw Configuration Reference

After JAMES is running, configure OpenClaw like this:

```json
{
  "models": {
    "providers": {
      "james": {
        "baseUrl": "http://127.0.0.1:8000/v1",
        "apiKey": "james-local",
        "api": "openai-completions",
        "models": [
          {
            "id": "gemma-4-27b-it",
            "name": "Gemma 4 27B Instruct",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0 },
            "contextWindow": 131072,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "james/gemma-4-27b-it"
      }
    }
  }
}
```