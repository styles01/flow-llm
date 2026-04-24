# Qwen3.6-35B Tool Calling Setup

How tool calling, thinking mode, and vision work for `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit` in Flow LLM, and what was changed to make it reliable.

---

## What Qwen3.6-35B-A3B Is

Qwen3.6-35B-A3B is a **sparse Mixture-of-Experts vision-language model** from Alibaba's Qwen team (Apache 2.0). Despite its 35B total parameters it only activates ~3B per token at inference time. It is a full multimodal model with:

- A built-in **vision encoder** supporting images, documents, and video
- **Extended thinking** (chain-of-thought via `<think>...</think>` blocks)
- **Tool calling** via structured `<tool_call>` tags
- **Agentic coding** capabilities (73.4% SWE-Bench)

It scores 81.7 on MMMU and 85.3 on RealWorldQA, outperforming Claude Sonnet 4.5 on both multimodal benchmarks.

---

## The Problem We Solved

When loaded naively, Qwen3.6 tool calls would not arrive in the structured `tool_calls` array that agents (OpenClaw, Hermes) expect. Instead they appeared as raw text inside the `content` field. There were two compounding issues:

### Issue 1 — Tool calls landing inside `<think>` blocks

The `qwen3` tool-call parser looks for `<tool_call>` tags in the model's **output** content. But:

1. Our Jinja template was adding `<think>\n` to the **generation prefix** (the input side of the prompt)
2. The model's first *output* token was therefore `</think>` (closing the think block immediately)
3. The tool call appeared after `</think>`, inside the model's output, but…
4. The reasoning parser also only sees model *output* — it found no `<think>` opening tag there, so it returned the entire output (including `</think>`) as `content`
5. The tool-call parser stripped `<tool_call>` out, but left `</think>\n\n` in `content`

**Fix:** Remove `<think>` from the generation prefix in the template entirely. The model generates its full `<think>...reasoning...</think>` block as *output*, where the `qwen3` reasoning parser can find it, strip it into `reasoning_content`, and pass the clean remainder to the tool-call parser.

### Issue 2 — Template crashing on `tools = None`

The template used `{% if tools is defined and tools|length > 0 %}`. When `tools` is passed as `None` (not omitted), `None|length` raises `object of type 'NoneType' has no len()`, breaking all non-tool requests.

**Fix:** Changed to `{% if tools %}` — safely handles `None`, undefined, and empty list.

### Issue 3 — Multimodal round-trip crash

When loading with `--model-type multimodal` (required for vision support), tool-call round-trips (sending the tool result back for a final answer) crashed with:

```
Failed to generate multimodal response: can only concatenate str (not "NoneType") to str
```

Root cause: `mlx_vlm.py` line 738 passes `message.content` directly for assistant messages. When an assistant message has `tool_calls`, the OpenAI spec allows `content: null`. The VLM handler didn't guard against this, causing a downstream string concatenation to fail.

**Fix:** The Flow proxy (`main.py`) now coerces `null` → `""` for any assistant message's `content` before forwarding to the backend. This allows multimodal mode + tool calling to coexist.

### Issue 4 — Auto-select missing reasoning parser

When a Qwen model was loaded via the UI Load Dialog (or API without explicit `mlx_reasoning_parser`), the auto-select logic in `main.py` would set `tool_call_parser = "qwen3"` but leave `reasoning_parser` empty. Without the reasoning parser, the full `<think>...thinking...</think>` block leaked into `content`.

**Fix:** The auto-select logic now also sets `mlx_reasoning_parser = "qwen3"` for Qwen models when it auto-selects the tool-call parser.

---

## Correct Load Parameters

Load via the Flow API or UI with these parameters:

```json
{
  "mlx_context_length": 262144,
  "mlx_prompt_cache_size": 10,
  "mlx_enable_auto_tool_choice": true,
  "mlx_reasoning_parser": "qwen3",
  "mlx_tool_call_parser": "qwen3",
  "mlx_model_type": "multimodal",
  "mlx_chat_template_file": "/path/to/JAMES-LLM/templates/qwen36_tools_hermes.jinja"
}
```

Or via curl:

```bash
curl -X POST http://localhost:3377/api/models/unsloth__Qwen3.6-35B-A3B-UD-MLX-4bit/load \
  -H 'Content-Type: application/json' \
  -d '{
    "mlx_context_length": 262144,
    "mlx_prompt_cache_size": 10,
    "mlx_enable_auto_tool_choice": true,
    "mlx_reasoning_parser": "qwen3",
    "mlx_tool_call_parser": "qwen3",
    "mlx_model_type": "multimodal",
    "mlx_chat_template_file": "/Users/jameyaita/JAMES-LLM/templates/qwen36_tools_hermes.jinja"
  }'
```

**Why `multimodal`?** Qwen3.6-35B-A3B has a built-in vision encoder. Using `lm` model type disables vision entirely.

**Why `qwen3` not `qwen3_vl` for reasoning?** `qwen3_vl` requires `--model-type multimodal` AND has its own issues with the synthetic `<think>` prefix. The `qwen3` reasoning parser works correctly with multimodal type and our custom template.

---

## The Chat Template (`qwen36_tools_hermes.jinja`)

Located at `templates/qwen36_tools_hermes.jinja`. Key design decisions:

### Generation prefix — no `<think>`
```jinja
{% if add_generation_prompt %}
    {{- '<|im_start|>assistant\n' }}
{% endif %}
```
No `<think>` prefix. This is intentional — the model generates the full `<think>...</think>` block as part of its output, which the reasoning parser can then cleanly strip.

### Tool instructions in system block
When tools are present, the template appends tool call instructions to the system message:
- Lists available functions with name, description, parameters
- Instructs the model to output `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` in Hermes JSON format (not the native broken XML format)
- Explicitly tells the model the `<tool_call>` tag must appear **after** `</think>`, not inside it

### Tool result handling
Tool results (`role: "tool"`) are rendered as:
```
<|im_start|>user
<tool_response>...result...</tool_response>
<|im_end|>
```

### History replay for tool calls
When replaying tool-call turns from conversation history (assistant message with `tool_calls`), the format is:
```
<|im_start|>assistant
<tool_call>{"name": "...", "arguments": {...}}</tool_call>
<|im_end|>
```

---

## Changes Made to Flow LLM

### `templates/qwen36_tools_hermes.jinja`
- Removed `<think>` from generation prefix
- Fixed `tools is defined and tools|length > 0` → `{% if tools %}` (null-safe)
- Rewrote tool instructions to use JSON format and explicitly place tool calls after `</think>`
- Added content guard for assistant messages in history replay

### `server/flow_llm/main.py`
- **Auto-select**: when `supports_tools=True` and model is Qwen, now auto-sets both `tool_call_parser="qwen3"` AND `reasoning_parser="qwen3"` (previously only set `tool_call_parser`)
- **Null content fix**: proxy now coerces `assistant.content = null` → `""` before forwarding to multimodal backends, fixing the VLM round-trip crash
- **Per-model runtime config** (previous session): `_model_configs` in-memory dict, GET/PUT/DELETE `/api/models/{id}/config`
- **Presets system** (previous session): built-in + user presets, full CRUD at `/api/presets`, saved to `~/.flow/presets.json`

### `web/src/components/ModelConfigDrawer.tsx` (previous session)
New slide-in drawer on the Monitor page with:
- Preset picker (built-in read-only + user-saved)
- Fields: `preserve_thinking`, `enable_thinking`, `temperature`, `top_p`, `top_k`, `presence_penalty`, `repetition_penalty`
- Apply / Save / Save As… / Reset actions
- Toast notifications

### `web/src/store/sessionStore.ts` (previous session)
Chat history is now persisted to `localStorage` (key: `flow_chat_session`). Survives page reloads. Stores messages, selected model, and system prompt.

---

## Verified Test Results

All via the Flow proxy at `http://localhost:3377/v1/chat/completions` (the OpenAI endpoint Hermes/OpenClaw uses):

| Test | Expected | Result |
|------|----------|--------|
| Plain chat (no tools) | `finish_reason: stop`, thinking in `reasoning_content`, clean `content` | ✅ |
| First-turn tool call | `finish_reason: tool_calls`, `content: ""`, proper `tool_calls` array | ✅ |
| Round-trip (tool result → answer) | `finish_reason: stop`, clean answer, no `</think>` leak | ✅ |
| Parallel tool calls | Both tool calls extracted | ✅ |

---

## Vision Support Status

Qwen3.6-35B-A3B **is** a VLM. To use vision (image inputs), load with `--model-type multimodal`. The null-content proxy fix above re-enables multimodal mode. Pass images as base64 or URL in the standard OpenAI multimodal content format:

```json
{
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What's in this image?"},
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
    ]
  }]
}
```

The Flow UI chat page does not yet support image inputs — that's a planned V2 feature.
