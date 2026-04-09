# JAMES Project Plan

**Just A Model Execution Server** — phased implementation plan.

---

## Phase 0: Foundation (Day 1)

**Goal:** Project scaffolding, dev environment, backend validation.

| Task | Detail | Depends On |
|------|--------|------------|
| Create project structure | Monorepo: `server/` (Python), `web/` (React), `docs/` | — |
| Install and test llama.cpp | Download binary, run a GGUF model, verify `/v1/chat/completions` works with system prompt | — |
| Install and test mlx-openai-server | pip install, run an MLX model, verify OpenAI API compatibility | — |
| Validate Gemma 4 GGUF | Load `google/gemma-4-27b-it-GGUF` via llama.cpp, test system prompt + tool calling | llama.cpp installed |
| Create FastAPI skeleton | App structure, health endpoint, CORS | — |
| Create React skeleton | Vite + React + Tailwind, basic layout shell | — |

**Deliverable:** Both backends running independently. Skeleton app builds.

---

## Phase 1: Model Management (Days 2-3)

**Goal:** Download, validate, and register models from HuggingFace.

| Task | Detail | Depends On |
|------|--------|------------|
| HuggingFace Hub client | Search models, list GGUF/MLX files, download with progress | Phase 0 |
| Template validator | Jinja syntax check, system role check, tool call check, tokenizer completeness check | Phase 0 |
| Model registry (SQLite) | Schema, CRUD operations, model metadata | Phase 0 |
| Download endpoint | `POST /api/models/download` — download model + validate template | HF client, validator |
| Model list/detail endpoints | `GET /api/models`, `GET /api/models/{id}` | Registry |
| Delete endpoint | `DELETE /api/models/{id}` — remove files + registry entry | Registry |

**Deliverable:** Can search HuggingFace, download models, validate templates, see them in registry.

---

## Phase 2: Backend Lifecycle (Days 3-4)

**Goal:** Start/stop backend servers, route inference requests.

| Task | Detail | Depends On |
|------|--------|------------|
| Process manager | Start/stop llama.cpp and mlx-openai-server as subprocesses | Phase 1 |
| Port assignment | Dynamic port allocation, track running servers | Process manager |
| Health checks | Periodic ping to backend servers, auto-mark as unhealthy | Process manager |
| Load/unload endpoints | `POST /api/models/{id}/load`, `POST /api/models/{id}/unload` | Process manager |
| Proxy router | `/v1/chat/completions` — route by model name, streaming passthrough | Process manager |
| `/v1/models` endpoint | List loaded models in OpenAI format | Registry |

**Deliverable:** Can load a model, OpenClaw can query it through the proxy.

---

## Phase 3: Frontend — Core (Days 5-7)

**Goal:** Working frontend with model management and dashboard.

| Task | Detail | Depends On |
|------|--------|------------|
| Model Browser page | Search HF, see local models, download button, progress bars | Phase 1 API |
| Running Models page | See loaded models, memory bars, start/stop buttons, status | Phase 2 API |
| Chat Test page | System prompt editor, message input, tool call simulator, streaming output | Phase 2 proxy |
| Settings page | Hardware profile, default ports, HF token, storage path | Phase 1 |
| WebSocket updates | Real-time model status, download progress | Phase 2 |
| Memory indicator | Show used/available unified memory | Phase 2 |

**Deliverable:** Full management UI. Can browse, download, load, and test models.

---

## Phase 4: Telemetry (Days 7-8)

**Goal:** Performance visibility — TTFT, throughput, token counting.

| Task | Detail | Depends On |
|------|--------|------------|
| TTFT measurement | Time from request forward to first token in stream | Phase 2 proxy |
| Token counting | Count input/output tokens from API response | Phase 2 proxy |
| Throughput calc | Tokens/sec from timing data | TTFT + token counting |
| Telemetry storage | SQLite table for request logs | Phase 2 |
| Telemetry API | `GET /api/telemetry` — per-model stats, time-range filtering | Storage |
| Telemetry frontend | Charts (TTFT over time, throughput comparison), request log viewer | Telemetry API |

**Deliverable:** Can see performance metrics for every inference request.

---

## Phase 5: OpenClaw Integration & Validation (Days 8-9)

**Goal:** Prove the system works end-to-end with OpenClaw.

| Task | Detail | Depends On |
|------|--------|------------|
| OpenClaw config generator | Generate `openclaw.json` pointing to JAMES proxy | Phase 2 |
| System prompt validation suite | Automated tests: system role respected, no hidden injection | Phase 2 |
| Tool calling validation suite | Automated tests: function calling works for Qwen 3, Gemma 4, Llama 4 | Phase 2 |
| Long context test | Measure performance degradation at 4K, 8K, 16K context | Phase 4 |
| Fidelity comparison | Same prompt → compare JAMES output vs. direct llama.cpp output (must be identical) | Phase 2 |
| Dual-hardware test | Run on Mini + Max independently, verify profile detection | Phase 3 |

**Deliverable:** Validated system that works correctly with OpenClaw on both Macs.

---

## Phase 6: Polish & Hardening (Days 9-10)

**Goal:** Production-ready for daily use.

| Task | Detail | Depends On |
|------|--------|------------|
| Auto-start on login | macOS launchd plist for management server | Phase 5 |
| Graceful shutdown | Unload models, stop backends, persist state on quit | Phase 2 |
| Error recovery | Backend crash detection, auto-restart, clear error messages | Phase 2 |
| Disk space management | Warn when low, model size estimates, cache cleanup | Phase 1 |
| Config export/import | Share config between Mini and Max | Phase 3 |
| Documentation | README, setup guide, architecture reference | Phase 5 |

**Deliverable:** Daily-driver ready. Auto-starts, handles errors, documented.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| llama.cpp doesn't support a new model architecture | Medium | High | Keep llama.cpp updated; GGUF community is fast with new model support |
| mlx-openai-server has bugs | Medium | Medium | GGUF is the fallback; MLX is secondary |
| Chat template rendering differs from HF | Low | High | Template validator catches this pre-load; fidelity tests in Phase 5 |
| 16GB Mini can't run useful models | Low | High | Q4 quantization of 8-10B models fits; MoE models are memory-efficient |
| Proxy adds too much latency | Very Low | Medium | Measure in Phase 4; can bypass proxy if needed |
| HuggingFace download API changes | Low | Low | `huggingface_hub` is a stable, maintained library |

---

## Not In Scope (Future)

- Multi-machine network routing (both Macs independent for now)
- Automatic GGUF → MLX conversion
- vLLM support (Linux only)
- Distributed inference
- Model fine-tuning
- Anthropic Messages API compatibility (OpenAI API only for now)
- Docker containerization (native macOS app)