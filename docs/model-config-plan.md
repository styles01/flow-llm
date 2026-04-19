# Model Config / Per-Request Params Plan

Slide-in drawer on the Monitor page for per-model runtime configuration — injected into every proxied request for a loaded model. Presets are persistent and user-editable.

---

## Problem

Two distinct categories of model parameters exist today but only one is handled:

| Category | Where set | Examples | Status |
|----------|-----------|---------|--------|
| **Load-time params** | Load Dialog | ctx_size, reasoning_parser, model_type | ✅ Done |
| **Per-request params** | Nowhere | preserve_thinking, enable_thinking, temperature, top_p, top_k, presence_penalty | ❌ Missing |

Per-request params need to be injected into every `/v1/chat/completions` call that passes through the Flow proxy for a given model.

---

## UX Design

### Entry point
Each model card on Monitor page has a **[Configure]** button → opens a slide-in drawer from the right. Does not navigate away.

### Drawer layout
```
┌──────────────────────────────────────────────────────┐  ←  right edge
│  Qwen3.6-35B  [MLX · port 8100]              [✕]    │
│  ──────────────────────────────────────────────────  │
│  PRESET                                              │
│  [Qwen3.6 Thinking ▼]   [Save]  [Save As...]        │
│  ──────────────────────────────────────────────────  │
│  RUNTIME CONFIG  (applied to every request)          │
│                                                      │
│  preserve_thinking   [✓ on ]                        │
│  enable_thinking     [✓ on ]                        │
│                                                      │
│  temperature         [0.6  ]  ●────────── 2.0       │
│  top_p               [0.95 ]  ●────────── 1.0       │
│  top_k               [20   ]                        │
│  presence_penalty    [1.5  ]                        │
│  repetition_penalty  [——   ]  (blank = not set)     │
│                                                      │
│  [+ Add custom chat_template_kwarg]                 │
│  ──────────────────────────────────────────────────  │
│  LOAD PARAMS  (read-only · set at load time)         │
│  context: 262,144  ·  parser: qwen3_vl              │
│                              [Reload with changes…] │
└──────────────────────────────────────────────────────┘
```

### Preset flow
1. User selects preset from dropdown → all fields populate
2. User tweaks individual fields (preset label stays, shows as "modified")
3. **[Save]** — overwrites the selected preset with current field values
4. **[Save As…]** — prompts for name → creates new user preset
5. **[Reset]** — clears all runtime config (no injection, backend defaults apply)

### Preset types
- **Built-in** (read-only, cannot overwrite) — shipped with Flow, shown in italic
- **User** (editable/deletable) — saved to `presets.json`; user can Save/Save As/Delete

---

## Architecture

### Backend — Runtime Config

**Storage:** In-memory dict `_model_configs: dict[str, dict]` in `main.py` — ephemeral, cleared on unload/restart. This is intentional: load params are durable, runtime config is session-scoped.

**Endpoints:**
```
GET    /api/models/{model_id}/config   → current active config
PUT    /api/models/{model_id}/config   → set config (merge, caller values win)
DELETE /api/models/{model_id}/config   → reset to empty
```

**Proxy injection** (both streaming + non-streaming paths):
```python
config = _model_configs.get(model_id, {})
if config:
    for k in ("temperature", "top_p", "top_k", "presence_penalty", "repetition_penalty"):
        if k in config and k not in body:
            body[k] = config[k]
    if "chat_template_kwargs" in config:
        extra = body.setdefault("extra_body", {})
        extra.setdefault("chat_template_kwargs", {}).update(config["chat_template_kwargs"])
```

Caller values always take precedence — config is a *default injection*, not a forced override.

### Backend — Preset Storage

**File:** `{flow_data_dir}/presets.json` — same directory as `settings.json`.

**Format:**
```json
{
  "user_presets": [
    {
      "id": "uuid4",
      "name": "My Qwen3.6 Setup",
      "config": {
        "temperature": 0.6,
        "top_p": 0.95,
        "top_k": 20,
        "presence_penalty": 1.5,
        "chat_template_kwargs": { "preserve_thinking": true, "enable_thinking": true }
      }
    }
  ]
}
```

Built-in presets are hardcoded in the backend (not stored in file) and returned alongside user presets.

**Endpoints:**
```
GET    /api/presets              → [built-ins] + user presets
POST   /api/presets              → create user preset → {id, name, config}
PUT    /api/presets/{id}         → update user preset (name and/or config)
DELETE /api/presets/{id}         → delete user preset (built-ins are rejected)
```

### Frontend

**New component:** `web/src/components/ModelConfigDrawer.tsx`

**API client additions** (`client.ts`):
```ts
// Runtime config
getModelConfig:   (id) => fetchAPI(`/models/${id}/config`)
setModelConfig:   (id, config) => fetchAPI(`/models/${id}/config`, { method: 'PUT', body: JSON.stringify(config) })
resetModelConfig: (id) => fetchAPI(`/models/${id}/config`, { method: 'DELETE' })

// Presets
listPresets:    () => fetchAPI('/presets')
createPreset:   (name, config) => fetchAPI('/presets', { method: 'POST', body: JSON.stringify({ name, config }) })
updatePreset:   (id, data) => fetchAPI(`/presets/${id}`, { method: 'PUT', body: JSON.stringify(data) })
deletePreset:   (id) => fetchAPI(`/presets/${id}`, { method: 'DELETE' })
```

---

## Built-in Presets

| Name | temp | top_p | top_k | presence_penalty | chat_template_kwargs |
|------|------|-------|-------|-----------------|----------------------|
| Qwen3.6 — Thinking | 0.6 | 0.95 | 20 | 1.5 | preserve_thinking: true, enable_thinking: true |
| Qwen3.6 — No Thinking | 0.7 | 0.8 | 20 | 1.5 | enable_thinking: false |
| Qwen3.6 — Thinking (coding) | 0.6 | 0.95 | 20 | 0.0 | preserve_thinking: true, enable_thinking: true |
| Gemma 4 | 1.0 | — | — | — | — |
| Default (no injection) | — | — | — | — | — |

---

## Key Qwen3.6 Params

| Param | Value | Effect |
|-------|-------|--------|
| `preserve_thinking` | `true` | Retains `<think>` blocks in history — **critical for OpenClaw multi-turn** |
| `enable_thinking` | `true`/`false` | Toggle thinking mode per-request |
| `temperature` | 0.6 (coding) / 1.0 (general) | Qwen3.6 recommended |
| `top_p` | 0.95 | Qwen3.6 recommended |
| `top_k` | 20 | Qwen3.6 recommended |
| `presence_penalty` | 1.5 (general) / 0.0 (coding) | Reduces repetition |

---

## Files to Change

| File | Change |
|------|--------|
| `server/flow_llm/main.py` | `_model_configs` dict, config endpoints, preset endpoints, proxy injection |
| `server/flow_llm/config.py` | `presets_path` setting, load/save helpers |
| `web/src/api/client.ts` | Runtime config + preset API methods |
| `web/src/components/ModelConfigDrawer.tsx` | New — drawer UI with preset picker, fields, save/save-as |
| `web/src/pages/Monitor.tsx` | Add [Configure] button to each model card, wire drawer open/close |

---

## Implementation Order

1. Backend: `_model_configs` + config endpoints + proxy injection
2. Backend: `presets.json` storage + preset CRUD endpoints + built-in presets
3. Frontend: `client.ts` additions
4. Frontend: `ModelConfigDrawer.tsx` component
5. Frontend: [Configure] button on Monitor cards
6. Test: Qwen3.6 `preserve_thinking` round-trip, preset save/load

---

## Notes

- Blank/null field = not injected (backend default applies). Explicitly set values override.
- The `+ Add custom chat_template_kwarg` row lets power users set arbitrary kwargs without a dedicated UI field.
- "Reload with changes" in the Load Params section opens the Load Dialog pre-filled — doesn't auto-reload.
- Config is session-scoped (ephemeral). Presets are persistent. They are separate concerns.
