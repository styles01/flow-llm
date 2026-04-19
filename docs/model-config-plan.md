# Model Config / Per-Request Params Plan

LM Studio-style per-model configuration that gets injected into every proxied request for a loaded model.

---

## Problem

Two distinct categories of model parameters exist today but only one is handled:

| Category | Where set | Examples | Status |
|----------|-----------|---------|--------|
| **Load-time params** | Load Dialog | ctx_size, reasoning_parser, model_type | ✅ Done |
| **Per-request params** | Nowhere | preserve_thinking, enable_thinking, temperature, top_p, top_k, presence_penalty | ❌ Missing |

Per-request params need to be injected into every `/v1/chat/completions` call that passes through the Flow proxy for a given model. This is equivalent to LM Studio's "Model Config" panel.

---

## Architecture

### Backend

**Storage:** `model_configs` table in SQLite (or in-memory dict keyed by `model_id` — simpler, since configs are ephemeral to a loaded session).

Use an in-memory dict `_model_configs: dict[str, dict]` in `main.py` — cleared when model unloads, no migration needed.

**New endpoints:**
```
GET  /api/models/{model_id}/config        → current per-request config
PUT  /api/models/{model_id}/config        → update config (merge, not replace)
DELETE /api/models/{model_id}/config      → reset to empty
```

**Proxy injection** (`main.py` streaming + non-streaming proxy paths):
```python
config = _model_configs.get(model_id, {})
if config:
    body["temperature"] = config.get("temperature", body.get("temperature"))
    body["top_p"] = config.get("top_p", body.get("top_p"))
    # chat_template_kwargs merged into extra_body
    if "chat_template_kwargs" in config:
        extra = body.setdefault("extra_body", {})
        extra.setdefault("chat_template_kwargs", {}).update(config["chat_template_kwargs"])
```

Config keys injected (caller values take precedence — config is the *default*, not an override):
- `temperature`
- `top_p`
- `top_k`
- `presence_penalty`
- `repetition_penalty`
- `chat_template_kwargs` → merged into `extra_body.chat_template_kwargs`
  - `preserve_thinking` (Qwen3.6 — retains reasoning across turns)
  - `enable_thinking` (Qwen3 — false to disable thinking mode)

### Frontend

**Where:** Monitor page, inline on each running model card. A "Model Config" collapsible section below the slot activity strip.

**UI layout:**
```
┌─ unsloth__Qwen3.6-35B-A3B-UD-MLX-4bit  [port 8100]  [Unload] ─┐
│  Slots: ■ generating  ■ idle                                    │
│  70 tok/s                                                       │
│                                                                 │
│  ▼ Model Config                                                 │
│    Preset: [Qwen3.6 Thinking ▼]  [Reset]                       │
│                                                                 │
│    preserve_thinking  [✓ enabled]                              │
│    enable_thinking    [✓ enabled]                              │
│    temperature        [0.6      ]                              │
│    top_p              [0.95     ]                              │
│    top_k              [20       ]                              │
│    presence_penalty   [1.5      ]                              │
│                                                                 │
│    [+ Add custom key]                                          │
└─────────────────────────────────────────────────────────────────┘
```

**Presets** (same pattern as Load Dialog presets):
```ts
const MODEL_CONFIG_PRESETS = {
  qwen3_6_thinking: {
    label: 'Qwen3.6 — Thinking (recommended)',
    config: {
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
      presence_penalty: 1.5,
      chat_template_kwargs: { preserve_thinking: true, enable_thinking: true },
    }
  },
  qwen3_6_no_thinking: {
    label: 'Qwen3.6 — No Thinking',
    config: {
      temperature: 0.7,
      chat_template_kwargs: { enable_thinking: false },
    }
  },
  gemma4: {
    label: 'Gemma 4',
    config: { temperature: 1.0 },
  },
}
```

**API client additions** (`client.ts`):
```ts
getModelConfig: (id) => fetchAPI(`/models/${id}/config`)
setModelConfig: (id, config) => fetchAPI(`/models/${id}/config`, { method: 'PUT', body: JSON.stringify(config) })
resetModelConfig: (id) => fetchAPI(`/models/${id}/config`, { method: 'DELETE' })
```

---

## Key Qwen3.6 Params (from Qwen docs)

| Param | Value | Where | Effect |
|-------|-------|-------|--------|
| `preserve_thinking` | `true` | `chat_template_kwargs` | Retains `<think>` blocks in conversation history — critical for multi-turn agentic use (OpenClaw) |
| `enable_thinking` | `true`/`false` | `chat_template_kwargs` | Toggle thinking mode per-request |
| `temperature` | `0.6` | top-level | Qwen3.6 recommended default |
| `top_p` | `0.95` | top-level | Qwen3.6 recommended |
| `top_k` | `20` | top-level | Qwen3.6 recommended |
| `presence_penalty` | `1.5` | top-level | Reduces repetition in long agentic outputs |

`preserve_thinking` is especially important for OpenClaw: without it, `<think>` blocks from prior turns are stripped from the context window, degrading multi-turn reasoning quality.

---

## Files to Change

| File | Change |
|------|--------|
| `server/flow_llm/main.py` | `_model_configs` dict, GET/PUT/DELETE endpoints, inject in both proxy paths |
| `web/src/api/client.ts` | `getModelConfig`, `setModelConfig`, `resetModelConfig` |
| `web/src/pages/Monitor.tsx` (or Running.tsx) | Model Config collapsible section per model card |

---

## Implementation Order

1. Backend: `_model_configs` dict + 3 endpoints + proxy injection (~50 lines)
2. Frontend: `client.ts` additions
3. Frontend: Model Config UI on Monitor page with presets
4. Test: Qwen3.6 `preserve_thinking` round-trip through proxy

---

## Notes

- Config is **ephemeral** (in-memory) — cleared on model unload or server restart. This is intentional: load params are durable, runtime config is session-scoped.
- Caller values in the request body always take precedence over config defaults. Config is a *default injection*, not a forced override.
- The `+ Add custom key` button lets power users set arbitrary `chat_template_kwargs` without a UI field for every possible option.
