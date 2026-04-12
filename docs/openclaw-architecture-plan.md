# OpenClaw Local Inference Architecture Plan

## 1. Objective

Design a **flexible, high-fidelity local inference architecture** for OpenClaw that:

- Preserves **native model behavior** (especially system + tool prompts)
- Supports **multiple runtimes** (MLX + GGUF)
- Avoids **vendor lock-in** (LM Studio, Ollama, etc.)
- Enables **telemetry + observability**
- Is **extensible and hackable** (forkable OSS components)

---

## 2. Core Problem Statement

OpenClaw places unique stress on inference stacks due to:

- Heavy **system prompt usage**
- Tool/function calling
- Long context windows
- Multi-step agent loops

### Observed Issues

1. **LM Studio breaks model semantics**
   - Jinja template failures
   - System prompts not supported or unstable
   - Hidden prompt injection
   - Model-specific adaptations

2. **Ollama performance limitations**
   - Slow under long context
   - High overhead per request

3. **Model fidelity degradation**
   - Tool calling fails
   - Role handling inconsistent
   - Behavior differs from official APIs

4. **Lack of telemetry in OpenAI API spec**
   - No built-in TTFT
   - No throughput metrics
   - No internal visibility

---

## 3. Design Principles

### 3.1 Fidelity First

- No rewriting prompts
- Preserve system/user/assistant roles
- Use official tokenizer + templates

### 3.2 Backend Agnostic

- Support multiple runtimes
- Route per model

### 3.3 Separation of Concerns

| Layer | Responsibility |
|------|----------------|
| OpenClaw | Agent logic |
| Proxy | Routing + telemetry |
| Backend | Inference |
| UI | Optional debugging |

### 3.4 Observability

- Capture all performance metrics
- Log all requests
- Enable debugging

---

## 4. Existing Solutions Analysis

### 4.1 LM Studio

**Pros**
- Great UI
- Easy model management
- Built-in telemetry

**Cons**
- Breaks system prompts
- Template injection
- Limited control
- Model adaptations

**Verdict:** Not suitable as core backend

---

### 4.2 Ollama

**Pros**
- Simple
- Popular ecosystem

**Cons**
- Performance overhead
- Limited flexibility
- Abstraction hides behavior

**Verdict:** Not suitable for OpenClaw workloads

---

### 4.3 MLX (mlx-lm)

**Pros**
- Best performance on Mac
- Close to Hugging Face behavior
- Full control

**Cons**
- No UI
- No telemetry
- Requires server wrapper

**Verdict:** Best MLX backend

---

### 4.4 llama.cpp / GGUF

**Pros**
- Mature ecosystem
- Flexible quantization
- Stable

**Cons**
- Less HF-native
- Model quality varies

**Verdict:** Essential secondary backend

---

### 4.5 LocalAI

**Pros**
- Multi-backend support
- OpenAI-compatible

**Cons**
- Adds abstraction
- Less transparent

**Verdict:** Optional layer

---

### 4.6 MLX OpenAI Servers (mlx-openai-server, etc.)

**Pros**
- Clean API
- Minimal interference

**Cons**
- Early ecosystem
- Limited features

**Verdict:** Best starting point

---

## 5. Proposed Architecture

### 5.1 High-Level Flow

OpenClaw → Proxy → Backend → Model

---

### 5.2 Detailed Architecture

```
OpenClaw
   ↓
Telemetry Proxy (FastAPI / Node)
   ├── MLX Backend
   │      └── mlx-openai-server / mlx_lm.server
   │             └── HF / MLX models
   │
   └── GGUF Backend
          └── llama.cpp server
                 └── GGUF models
```

---

### 5.3 Optional Components

- Open WebUI (manual testing)
- LocalAI (future consolidation)

---

## 6. Proxy Layer Responsibilities

### API
- `/v1/chat/completions`

### Routing
- model name → backend mapping

### Telemetry
- TTFT
- tokens/sec
- input tokens
- output tokens
- context size

### Logging
- raw request
- raw response

### Optional
- fallback logic
- retries

---

## 7. Backend Strategy

### MLX Path

Use when:
- Model available on Hugging Face
- Need highest fidelity
- Gemma / Qwen / Mistral

### GGUF Path

Use when:
- Need flexible quantization
- Community models preferred
- Performance tradeoffs acceptable

---

## 8. Model Strategy

### MLX Models
- Official HF repos
- mlx-community conversions

### GGUF Models
- Trusted community builds
- Tested for tool usage

---

## 9. Implementation Plan

### Phase 1: Baseline
- Install MLX backend
- Install llama.cpp server
- Validate both independently

### Phase 2: Proxy
- Build minimal FastAPI proxy
- Pass-through requests

### Phase 3: Routing
- Add model-based routing

### Phase 4: Telemetry
- Add logging + metrics

### Phase 5: OpenClaw Integration
- Point to proxy endpoint

### Phase 6: Validation
- Test system prompts
- Test tool calls
- Compare outputs

---

## 10. Validation Tests

### System Prompt Test
- Ensure system role is respected

### Tool Calling Test
- Validate structured output

### Long Context Test
- Measure degradation

### Performance Test
- TTFT
- tokens/sec

---

## 11. Future Enhancements

- Add vLLM backend (Linux/NVIDIA)
- Add caching layer
- Add distributed inference
- Add model routing heuristics

---

## 12. Key Insight

The problem is not the model.

The problem is the **layer that sits between the model and OpenClaw**.

Solve that layer, and everything else becomes modular.

---

## 13. Summary

Build a **thin, transparent, backend-agnostic inference layer**:

- MLX for HF-native models
- GGUF for flexibility
- Proxy for control + telemetry

Avoid monolithic tools.

Control the interface.

---

## 14. Next Steps

1. Choose MLX server implementation
2. Stand up llama.cpp server
3. Build proxy skeleton
4. Run first OpenClaw test

---

END

