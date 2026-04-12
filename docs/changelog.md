# Changelog

## 2026-04-12

### Backend Update Management
- **Persisted settings to disk** — model load defaults and the `auto_update_backends` toggle are now saved in `settings.json` under the Flow data directory and loaded at startup.
- **Added backend version APIs** — new endpoints expose installed/latest versions and allow manual checks or upgrades: `/api/backend-versions`, `/api/check-updates`, and `/api/update-backend/{backend}`.
- **Background update check on startup** — the server now runs a non-blocking backend version check during startup and can auto-update supported installs when the setting is enabled.
- **Added `server/flow_llm/updater.py`** — centralizes version detection and update logic for Homebrew-installed `llama.cpp` and pip-installed `mlx-openai-server`.

### Instances: Live Model Activity
- **Added `/api/model-activity`** — returns per-model slot activity plus llama.cpp metrics such as queued turns, tokens/sec, and KV cache usage.
- **Reworked backend progress tracking to per-slot state** — stderr parsing now records slot-level `prefill` and `generating` state in `_slot_states` instead of a single global progress number.
- **Instances page now shows slot activity** — prefill bars, generating indicators, queue depth, and KV cache usage are rendered inline for each running model.
- **Models page now auto-refreshes local model status** every 5 seconds so background load/unload changes surface without a manual refresh.

### Chat: Fix Gemma Responses Being Swallowed
- **Added `reasoning_content` support** — Gemma 4 (via llama-server) sends thinking tokens in `delta.reasoning_content` instead of `delta.content`. The streaming parser was only reading `content`, causing ALL of Gemma's thinking to be silently dropped. Now both `content` and `reasoning_content` are accumulated separately and displayed correctly — thinking as a collapsible block, response text as the main bubble.
- **Added `reasoningContent` field to Message type** — assistant messages can now carry a separate `reasoningContent` string for models that use the `reasoning_content` SSE field.
- **Fixed over-aggressive control token stripping** — The regex `/<[a-z_]+>/g` was removing ANY lowercase HTML-like tag, eating Gemma's `<start_of_turn>`, `<end_of_turn>`, and other structural markers that might wrap content. Replaced with targeted removal of known control tokens only.
- **Handle unclosed `<|think|>` blocks** — If a model opens a think tag but never closes it (streaming cutoff, model stop), the content after it is now treated as thinking content instead of showing raw `<|think|>` tags.
- **Auto-expand thinking when no visible text** — If a response has thinking but no text content, thinking blocks auto-expand and show "No visible response text" hint instead of appearing as a blank bubble.
- **Fixed streaming telemetry** — Three bugs: `input_tokens` was set to `max_tokens` (output limit) instead of actual prompt tokens; `output_tokens` counted SSE deltas instead of actual tokens; `tokens_per_sec` was never computed for streaming. Now extracts `usage` from SSE chunks and calculates metrics correctly.

### Session State Persistence
- **Created ephemeral session store** (`web/src/store/sessionStore.ts`) — in-memory store using `useSyncExternalStore` that survives route changes but is gone on page refresh. Chat messages, selected model, system prompt, log lines, and other session state persist when navigating between pages.
- **Chat and Logs pages now retain state** across navigation — switching between Chat and Logs no longer resets messages, model selection, or log history.

### Chat Processing Progress
- **Added processing progress indicator in Chat** — when a model is processing a prompt (prefill phase), a progress bar with percentage appears inline in the chat before tokens start streaming. Polls `/api/processing-progress` every 500ms while streaming.
- **Added "Generating..." indicator** — when streaming is active but no processing progress is reported (tokens already flowing), a small spinner with "Generating..." appears inline.
- **Processing progress clears automatically** once tokens start flowing in the stream.
- **Backend: stderr progress monitoring** — `BackendProcess._monitor_stderr()` now parses per-slot prefill/generation state from backend stderr and updates `_slot_states`, which feed both `/api/processing-progress` and `/api/model-activity`.
- **Backend: stdout monitoring** — Added `_monitor_stdout()` thread to capture stdout lines from backend processes.
- **Backend: `/api/processing-progress` endpoint** — Returns processing progress for all currently processing models.
- **Backend: progress reset on request** — `reset_processing_progress()` called at start of chat completions, progress cleared in stream `finally` block.

### Logs Page
- **Added Logs page** for backend debugging — terminal-style log viewer with auto-scroll, polls `/api/logs` every 1s.
- **Model filter** — dropdown to filter logs by specific running model or view all.
- **Auto-scroll toggle** — checkbox to auto-scroll to newest logs, can be disabled to browse history.
- **Log level coloring** — errors/failures in red, warnings in amber, info/loaded in teal, debug in gray.
- **Status bar** — shows line count and polling interval.
- **Sidebar nav** — added "Logs" item with text-line icon between Chat and Telemetry.
- **Backend: log buffer** — rotating deque (2000 lines per model) captures both stdout and stderr from backend processes via `append_log()` / `get_logs()`.
- **Backend: `/api/logs` endpoint** — returns recent log lines with optional `model_id` filter and `lines` count parameter.

### Files Created (2026-04-12)
- `web/src/store/sessionStore.ts`
- `web/src/pages/Logs.tsx`
- `server/flow_llm/updater.py`

### Files Modified (2026-04-12)
- `server/flow_llm/config.py` — persisted settings load/save support
- `server/flow_llm/main.py` — backend version/update routes, startup update check, `/api/model-activity`
- `server/flow_llm/process_manager.py` — per-slot activity tracking instead of single progress number
- `web/src/pages/Settings.tsx` — backend versions/update controls, persisted auto-update toggle
- `web/src/pages/Running.tsx` — live activity strip for each running model
- `web/src/pages/Models.tsx` — periodic model list refresh
- `web/src/api/client.ts` — updater and model-activity API client types/endpoints
- `web/src/pages/Chat.tsx` — processing progress, generating indicator, session store
- `web/src/pages/Logs.tsx` — session store for log persistence across navigation
- `web/src/App.tsx` — added Logs route
- `web/src/components/Sidebar.tsx` — added Logs nav item with icon
- `web/src/api/client.ts` — added `getProcessingProgress()` and `getLogs()` endpoints
- `server/flow_llm/process_manager.py` — log buffer, `append_log()`, `get_logs()`, stdout monitor
- `server/flow_llm/main.py` — `/api/logs` and `/api/processing-progress` endpoints

## 2026-04-11

### Brand & Visual Identity
- **Fixed logo to mirrored oscilloscope waveform** — teal trace peaks above center axis, magenta trace is the exact reflection below, like a dual-trace oscilloscope. No more overlapping waveforms.
- **Updated favicon.svg** to match the new mirrored waveform design with grid lines and center axis.
- **Renamed all legacy brand references to "Flow"** in the UI (Settings.tsx OpenClaw config, provider key, display text).
- **Renamed "Chat Test" → "Chat"** and **"Running" → "Instances"** in sidebar nav and page headings.
- **Added CRT scanline overlay** to main content area for the synthwave/oscilloscope aesthetic.
- **Established full design token system** in `index.css` — color tokens, typography scale, spacing tokens, oscilloscope visual effects (phosphor glow, neon border, waveform animation).

### Navigation
- **Redesigned sidebar** with custom oscilloscope-themed SVG icons for each page (layer stack for Models, radar pulse for Instances, waveform bubble for Chat, ECG trace for Telemetry, gear-with-wave for Settings).
- **Added sidebar collapse/expand** — dual-mode sidebar (w-56 expanded, w-14 icon-only collapsed), state persisted in localStorage.
- **Added status badges** — green pulsing dot on Instances nav when models are running.
- **Added active state** — teal left border + phosphor glow on active nav item.
- **Added responsive mobile sidebar** — hamburger menu on screens < 768px, full-height overlay sidebar on tap.

### Critical Bug Fixes
- **Fixed Unload button on Instances page** — had no onClick handler, now calls `api.unloadModel()` with loading state.
- **Replaced chat single-line input with auto-resizing textarea** — Enter sends, Shift+Enter for newlines, max 6 rows.
- **Made "Go to Models" link clickable** on Instances empty state (was plain text).

### Shared Components (new)
- `Button.tsx` — primary/secondary/danger/ghost variants, sm/md sizes, consistent focus rings.
- `Card.tsx` — default/active/accent/danger variants with osc-glow effects.
- `InputField.tsx` — wraps input + textarea with label/hint/error support, consistent focus styling.
- `ConfirmationDialog.tsx` — replaces `window.confirm()`, focus trap, Escape to close, danger variant with warning icon.
- `Toast.tsx` — toast notification system (success/error/info), bottom-right, auto-dismiss 4s, border-left accent.
- `Sidebar.tsx` — icons, badges, collapse, responsive hamburger, logo area.
- `StatusBadge.tsx` — running (green pulse + port), available (teal outline), loading (amber), error (fuchsia).
- `MemoryBar.tsx` — gradient/solid variants, osc-glow on fill, animated width transitions.
- `EmptyState.tsx` — oscilloscope-style SVG illustrations per page type (models, instances, chat, telemetry), action buttons.
- `DownloadProgress.tsx` — polls `/api/downloads`, determinate/indeterminate progress bars.
- `ConnectionBanner.tsx` — health check polling, shows banner when backend is unreachable.

### Interaction Polish
- **Replaced `window.confirm()` with ConfirmationDialog** for model deletion — shows model name, explains permanent deletion.
- **Added toast notifications** for all async operations (scan complete, model load/unload, settings save).
- **Added scan results feedback** — toast shows "Found 3 new models" or "No new models found" after scan.
- **Added Chat conversation clear button** — resets messages and error state.
- **Made HuggingFace search results keyboard-navigable** — ArrowUp/Down to move focus, Enter to select, Escape to close, role=listbox/option for accessibility.
- **Added focus trap and Escape handling to LoadDialog** — Tab cycles inside dialog, Escape closes, aria-modal="true".
- **Made LoadDialog responsive** — `w-[min(520px,calc(100vw-2rem))]` instead of fixed 480px.

### Visual Hierarchy
- **Collapsed Register & Connect sections** on Models page into a `<details>` element labeled "Advanced: Register & Connect" — defaults to closed, reducing cognitive load.
- **Added guided empty states** with oscilloscope SVG illustrations and action buttons (Instances: "Go to Models", Models: "No models yet", Telemetry: "No data yet").
- **Added model loading progress indicator** — animated gradient progress bar with "Loading..." text when model status is "loading".
- **Added download progress indicators** — polls `/api/downloads`, shows determinate bar with percentage or indeterminate sliding bar.

### Accessibility
- **Fixed gray-500 contrast across all pages** — replaced `text-gray-500` with `text-gray-400` on dark backgrounds for WCAG AA compliance (4.6:1 vs 2.5:1 contrast ratio).
- **Added ARIA attributes** to ConfirmationDialog and LoadDialog (`aria-modal`, `aria-label`, `role="dialog"`).
- **Added role="listbox"/"option"** to HuggingFace search results.
- **Added aria-label** to sidebar collapse toggle and hamburger button.

### Error Handling
- **Created `formatError()` utility** — maps raw API errors to human-friendly messages (404, 500, 503, network errors, timeouts, disk space, connection refused).
- **Applied `formatError()` across all pages** — Chat, Models, Settings now show readable error messages instead of raw HTTP responses.
- **Added backend disconnected banner** — polls `/api/health` every 5s, shows "Flow server disconnected. Reconnecting..." banner when unreachable.

### Files Modified
- `web/src/App.tsx` — sidebar extraction, ToastProvider, ConnectionBanner, scanlines
- `web/src/pages/Models.tsx` — collapse Register/Connect, ConfirmationDialog, DownloadProgress, keyboard search, EmptyState, loading progress, toast, formatError
- `web/src/pages/Running.tsx` — unload mutation, Link to Models, EmptyState, gray-400 fix, Instances rename
- `web/src/pages/Chat.tsx` — textarea, Chat rename, clear button, formatError
- `web/src/pages/Settings.tsx` — Flow rename, formatError, gray-400 fix
- `web/src/pages/Telemetry.tsx` — EmptyState, gray-400 fix
- `web/src/components/LoadDialog.tsx` — focus trap, Escape, responsive width, aria attributes
- `web/src/index.css` — full design token system, oscilloscope effects, pulse-bar animation
- `web/public/favicon.svg` — mirrored oscilloscope waveform

### Files Created
- `web/src/components/Button.tsx`
- `web/src/components/Card.tsx`
- `web/src/components/InputField.tsx`
- `web/src/components/ConfirmationDialog.tsx`
- `web/src/components/Toast.tsx`
- `web/src/components/Sidebar.tsx`
- `web/src/components/StatusBadge.tsx`
- `web/src/components/MemoryBar.tsx`
- `web/src/components/EmptyState.tsx`
- `web/src/components/DownloadProgress.tsx`
- `web/src/components/ConnectionBanner.tsx`
- `web/src/utils/errors.ts`
- `docs/ux-redesign-plan.md`

---

## 2026-04-11

### HuggingFace Integration
- **Fixed file sizes showing as 0/null** — HuggingFace API requires `files_metadata=True` parameter on `model_info()` calls to return file sizes. Added to all relevant API calls in `hf_client.py`.
- **Fixed MLX download button doing nothing** — MLX models were not setting `mlx_repo_id` to themselves, causing the frontend to receive `null` and skip the download handler. MLX models now self-reference their own repo ID.
- **Improved GGUF variant discovery** — When a model has no GGUF files, the system now tries `bartowski/{name}-GGUF` in addition to `{author}/{name}-GGUF` naming patterns.

### Model Loading
- **Fixed missing backend error messages** — Process manager now raises `RuntimeError` with specific install instructions instead of returning `False` silently. Missing `mlx-openai-server` or `llama-server` now tell the user exactly what to install.
- **Added `shutil.which()` pre-check** — Before starting a model process, the system verifies the backend command exists. If not found, it fails immediately with a clear message rather than a cryptic startup failure.
- **Fixed memory check rejecting valid loads** — Was comparing estimated model size against available RAM, which is too conservative on macOS with unified memory (GPU and CPU share the same pool). Now uses total RAM minus headroom (8GB system + 15% overhead).
- **Auto-reset stale model statuses** — Models left in "running" or "error" state from a previous server session are automatically reset to "available" on startup.
- **Retry load for error-status models** — Models in "error" status can now be re-loaded. Both the Models page and Chat page show "Retry Load" / "Retry" buttons for error-status models.

### Chat Page Redesign
- **Chat bubble message styling** — User messages are right-aligned with teal bubbles, assistant messages are left-aligned with gray bubbles. System messages are hidden from display. Error messages show in red-tinted cards.
- **Collapsible thinking/reasoning blocks** — Models that emit thinking tags (Gemma 4 `<|think|>`, Claude `<thinking>`, Qwen 3/DeepSeek `<tool_call>Think...)` now have those blocks collapsed by default with a "Thinking..." label. Click to expand. Shows a preview of the thinking content.
- **Control token stripping** — Model control tokens like `<|end|>`, `<|channel|>`, `<|eot_id|>`, `[INST]`, etc. are now stripped from displayed text so the chat shows clean output.
- **Input pinned to viewport bottom** — Chat input area stays at the bottom of the viewport regardless of message count. Messages scroll in the space between the top bar and input area.
- **Inline telemetry after each response** — After each assistant response, a metrics bar shows TTFT, tokens/sec, and input/output token counts directly in the chat view.
- **Collapsible system prompt** — System prompt textarea is now collapsed by default with a one-line preview. Expand to edit.
- **Streaming indicator** — Send button shows a spinner animation during streaming.
- **Load model from chat** — If the selected model isn't running, a banner shows with a Load/Retry button inline in the chat.

### Load Dialog
- **Backend-aware parameter forms** — Load dialog now shows different parameters based on model backend:
  - **GGUF (llama.cpp)**: Context window, parallel slots, flash attention, KV cache quantization (k/v with q4_0 through f16), GPU layers, plus advanced: CPU threads, batch size, RoPE scaling/scale, mlock, mmap
  - **MLX (mlx-openai-server)**: Context length, prompt cache entries, auto tool choice, plus advanced: reasoning parser, chat template override, trust remote code
- **Backend type badge** — Shows GGUF (blue) or MLX (purple) badge in the dialog header.

### Documentation
- **Added Prerequisites section to README** — Documents required dependencies: llama.cpp, mlx-openai-server, Python 3.11+, Node.js 18+.
- **Added Dependencies tables** — Server and web dependencies listed with install commands.
- **Renamed package** — the Python package now lives at `flow_llm` and `pyproject.toml` exposes the public package name `flow-llm`.

### Backend Integration
- **MLX load parameters wired through** — The MLX-specific fields from the load dialog (context-length, prompt-cache-size, enable-auto-tool-choice, reasoning-parser, chat-template-file, trust-remote-code) are now passed through the full stack: frontend `loadModel()` → `ModelLoadRequest` → `process_manager.start_model()` → `BackendProcess.build_command()`. MLX params are conditionally included based on backend type.

### Chat Response Parsing Fixes
- **Fixed over-aggressive control token stripping** — The regex `/<[a-z_]+>/g` was stripping ANY lowercase HTML-like tag, including legitimate structural markers from models. Replaced with targeted removal of known control tokens only (`<|end|>`, `<|channel|>`, `<start_of_turn>`, `<end_of_turn>`, `<im_end>`, `<im_sep>`, `[INST]`). This was causing Gemma responses to appear swallowed.
- **Handle unclosed `<|think|>` blocks** — If a model opens a think tag but never closes it (streaming in progress or model stops), the content after the tag was treated as regular text with raw `<|think|>` showing. Now detects unclosed think blocks and treats everything after them as thinking content.
- **Auto-expand thinking when no visible text** — If a response is entirely thinking blocks with no text content, the thinking blocks now auto-expand and a "No visible response text" hint is shown, instead of appearing as a blank bubble.

### Telemetry Fixes
- **Fixed streaming telemetry recording** — Three bugs in the streaming proxy path:
  - `input_tokens` was incorrectly set to `max_tokens` (the output limit) instead of actual prompt token count. Now extracts `usage.prompt_tokens` from SSE chunks when available.
  - `output_tokens` was counting SSE content deltas, not actual tokens. Now uses `usage.completion_tokens` from the final SSE chunk when the backend provides it.
  - `tokens_per_sec` was never computed for streaming responses. Now calculated from output tokens and elapsed time.
- **Fixed telemetry race condition in chat** — The frontend fetched telemetry immediately after streaming ended, but the backend's `_record_telemetry` runs in the generator cleanup which may not have committed yet. Added a 300ms delay before fetching.
