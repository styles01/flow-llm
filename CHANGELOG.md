# Changelog

All notable changes to Flow LLM will be documented in this file.

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