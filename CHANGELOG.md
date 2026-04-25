# Changelog

All notable changes to Flow LLM will be documented in this file.

## [Unreleased] - 2026-04-25

### Fixed
- **`peak_memory` crash on tool-call round-trips** — root cause: `app/models/mlx_vlm.py` only tracked `final_chunk` when `chunk.text` was truthy; tool-call responses have `content: ""` so `final_chunk` stayed `None`, crashing with `'NoneType' object has no attribute 'peak_memory'` → 500 on every follow-up. Fix: track `final_chunk` for all non-None chunks regardless of text content.
- **Null guard for `peak_memory` in handler** — belt-and-suspenders fix in `app/handler/mlx_vlm.py` for both streaming and non-streaming `log_debug_stats()` calls: `peak_memory if peak_memory is not None else 0.0`
- **`/metrics` 404 spam** — `/api/model-activity` was polling `GET /metrics` (Prometheus) on every backend every ~1s; mlx-openai-server doesn't implement this endpoint. Fixed by skipping the poll for MLX backends.
- **`_rescue_tool_calls()` unreachable from Anthropic path** — helpers were defined in local scope inside `chat_completions()` and unavailable to `/v1/messages`. Moved `_TC_RE`, `_parse_tc_json()`, and `_rescue_tool_calls()` to module level; wired rescue into the Anthropic non-streaming path.
- **Truncated responses ("Alright, James", "The", etc.)** — root cause: Hermes sends `max_tokens=4096`; with Qwen3's reasoning parser active, `<think>` tokens consume most of the budget leaving only 2–5 tokens for the actual response. Fix: proxy drops `max_tokens` from the forwarded request when `mlx_reasoning_parser` is active, letting the context window (262K) be the real cap.
- **Qwen3-Coder XML tool call format leaking as content** — `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit` uses the Qwen3-Coder XML tool format (`<function=name><parameter=x>v</parameter></function>`) regardless of chat template instructions. mlx-openai-server's `HermesToolParser` (JSON-only) silently returns XML as plain content. Fix: added `_XML_TC_RE` + `_parse_xml_tool_call()` to proxy rescue — XML-format tool calls are now parsed into standard `tool_calls[]` alongside JSON-format ones.
- **HTML-entity cascade corruption** — when a tool call leaked as text, Telegram/Hermes HTML-escaped it (`<tool_call>` → `&lt;tool_call&gt;`) in session storage. The model then mimicked the escaped format on every subsequent turn, and our rescue check `"<tool_call>" in content` returned False for the entity form. Fix: added `html.unescape()` as step 0 in `_rescue_tool_calls` — normalises HTML entities before any pattern matching, breaking the corruption cascade.
- **Residual `</think>` appearing in response content** — chat template doesn't force `<think>` as the generation prefix (unlike native Qwen3 template), so the reasoning parser never sees the opening tag and everything including `</think>` flows into `content`. Fix: `_THINK_CLOSE_RE` in `_rescue_tool_calls` strips `...\n</think>\n` from the front of content and moves it to `reasoning_content`.
- **Half-warm model poisoning client context** — requests arriving while model weights were still loading received malformed responses that Hermes stored permanently in session history, corrupting all subsequent turns. Fix: `backend_ready` guard on both `/v1/chat/completions` and `/v1/messages` returns 503 until the backend health-check passes.
- **Chat template auto-fill skipped when parser was explicit** — `mlx_chat_template_file` auto-fill was nested inside `if not tool_call_parser:`, so loading with an explicit `mlx_tool_call_parser` silently skipped the Hermes template. Fix: moved Qwen template auto-fill outside that block so it applies regardless.
- **Debug logging only covered streaming+tools path** — `[PROXY REQ]` and `[PROXY DEBUG]` prints were inside the `stream=True + tools` branch only. Added logging to all proxy paths: top of `chat_completions` (every request), non-streaming OpenAI path, and `/v1/messages` Anthropic path.

### Added
- **Warming-up UX on Monitor page** — models still loading weights show an amber pulsing dot, "warming up…" badge, and explanatory text; the Configure/Open UI buttons are disabled until `backend_ready=True`.
- **`backend_ready` field on `/api/models/running`** — server performs a live `GET /v1/models` health-check on each backend to distinguish "process started" from "weights fully loaded". Previously all running models reported as immediately ready.

## [Unreleased] - 2026-04-24

### Added
- **Qwen3.6-35B-A3B MLX support** — full tool calling + vision via `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit`
  - Custom chat template (`templates/qwen36_tools_hermes.jinja`) with Hermes JSON tool-call format, correct generation prefix (no `<think>` prefix so reasoning parser can strip it cleanly), and null-safe `{% if tools %}` guard
  - Proxy-level `_rescue_tool_calls()`: when the model skips `<think>` and goes straight to `<tool_call>`, the reasoning parser returns raw content and the backend tool parser is bypassed — the proxy now detects and extracts these stranded tool calls itself
  - Streaming + tools safety workaround: `stream=True` + tools present → proxy converts to non-streaming (which always parses correctly), then re-emits as SSE so Hermes/OpenClaw see a proper streaming interface
  - Auto-select logic now sets both `tool_call_parser=qwen3` AND `reasoning_parser=qwen3` for Qwen models (previously only set `tool_call_parser`)
  - Null content coercion: `assistant.content = null` → `""` before forwarding to multimodal backends, fixing VLM round-trip crash
- **Load presets** — presets now support an optional `load_params` key (alongside `config`) covering all mlx load-time parameters
  - Built-in "Qwen3.6 — Tools + Vision (full setup)" preset fills context length, parsers, model type, and template path in one click
  - `POST /api/presets` now accepts and stores `load_params`
  - Load Dialog fetches presets from the API and applies `load_params` to all form fields; replaces stale hardcoded frontend preset list
- Documentation: `docs/qwen36-tool-calling-setup.md` — full write-up of root causes, fixes, correct load parameters, and verified test results

### Fixed
- `<tool_call>` XML leaking into Hermes chat content when model skips thinking
- `finish_reason: stop` instead of `tool_calls` for streaming tool-call responses
- Multimodal round-trip crash: "can only concatenate str (not NoneType) to str"

## [1.0.0] - 2026-04-13

### Added
- Real-time Monitor page with per-request lifecycle tracking (queued → prefilling → generating → sending → completed)
- LM Studio-style odometer token counter with smooth catch-up animation and carry-borrow digit rolling
- WebSocket push for monitor updates (init snapshot + request_update + request_removed)
- `/api/requests` polling endpoint as WebSocket fallback
- `POST /api/requests/clear-stuck` endpoint to prune stuck requests (>120s in queued/generating)
- Auto-pruning of stuck requests on every `/api/requests` poll
- PWA manifest with dark theme (`#0a0a0a`) for Chrome app shortcuts
- Multi-resolution app icons: favicon.svg (dark background), icon-192.png, icon-512.png, apple-touch-icon.png
- `theme-color` meta tag and web manifest link in index.html
- Build script auto-copies dist/ to bundled frontend dir (`server/flow_llm/frontend/`)
- Build script cleans bundled frontend before copying to prevent stale asset hashes

### Changed
- Renamed "Instances" page to "Monitor" throughout UI (Sidebar, EmptyState, App.tsx)
- TTFT displayed in seconds with 1 decimal place throughout the app (e.g. "3.5s" instead of "3500ms")
- Telemetry page redesigned from raw HTML table to card-based layout with color-coded TTFT, formatted token counts, and error display
- Token labels clarified: "In" → "In tokens", "Out" → "Out tokens", "Total" → "Total tokens"
- Non-streaming proxy path returns 504 JSON error on timeout instead of crashing ASGI handler
- `reset_processing_progress()` changed to no-op — slot states now managed per-slot only (fixes parallel request visibility bug)
- "All slots idle" handler changed from bulk-clear to per-slot clearing

### Fixed
- Parallel request visibility: `reset_processing_progress()` no longer nukes all slot states when a new request arrives
- Missing telemetry numbers: added `_estimate_input_tokens()` fallback (~4 chars/token) when backend doesn't report `usage.prompt_tokens`
- Missing `total_tokens`: now computed from `input + output` when not provided by backend
- Static file serving: catch-all route now serves actual files from dist/ (favicon.svg, manifest.json, etc.) before falling back to SPA index.html
- Bundled frontend serving: favicon.svg and other root files were returning index.html because only `/assets` was mounted as static
- Proxy timeout crashes: httpx ReadTimeout no longer crashes the ASGI handler; returns clean 504/502 error responses
- httpx timeouts increased to 600s read (from 300s) with granular settings for deep thinking/reasoning requests

### Removed
- `web/src/pages/Running.tsx` — replaced by `Monitor.tsx`

### New Files
- `server/flow_llm/request_tracker.py` — per-request lifecycle tracking with broadcast throttling
- `web/src/components/TokenCounter.tsx` — odometer-style counter with rAF interpolation
- `web/src/components/RequestBeam.tsx` — stage-based request visualization
- `web/src/components/IdleWaveform.tsx` — CRT flatline animation for idle models
- `web/src/hooks/useWebSocket.ts` — WebSocket hook with auto-reconnect
- `web/src/store/monitorStore.ts` — real-time monitor state (useSyncExternalStore)
- `web/src/pages/Monitor.tsx` — real-time Monitor page
- `web/public/manifest.json` — PWA manifest
- `web/public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — app icons