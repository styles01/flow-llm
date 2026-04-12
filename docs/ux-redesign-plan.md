# Flow LLM — UX Redesign Plan

> **Visual direction: synthwave / bitcrushed oscilloscope.** Teal and magenta waveform traces mirrored across a center axis on a dark CRT-style background. Sharp, digital, retro-futuristic. NOT soft gradient blobs. Every surface should feel like you are staring into a vintage oscilloscope — phosphor glow, scan lines, neon traces on dark glass.

---

## 0. Design Tokens & Visual Language

Before any implementation, establish these as the canonical source of truth. Every subsequent item inherits from these tokens.

### 0.1 Color System

```
--color-bg-base:          #030712    (gray-950, CRT background black)
--color-bg-surface:       #111827    (gray-900, card/panel surface)
--color-bg-elevated:      #1f2937    (gray-800, input wells, hover states)
--color-bg-hover:         #1f2937    (gray-800, row hover)

--color-border:           #374151/40 (gray-700 at 40% opacity, subtle dividers)
--color-border-active:    #2dd4bf/40 (teal-400 at 40%, active/focus borders)
--color-border-accent:    #e879f9/30 (fuchsia-400 at 30%, accent borders)

--color-text-primary:     #f3f4f6    (gray-100, body text — 12.6:1 on bg-base)
--color-text-secondary:   #9ca3af    (gray-400, secondary text — 6.2:1 on bg-base)
--color-text-muted:       #6b7280    (gray-500, ONLY for decorative/label-paired text, NOT standalone)

--color-primary:          #2dd4bf    (teal-400, primary actions, active states)
--color-primary-dim:      #0d9488    (teal-600, primary button bg)
--color-primary-glow:     #2dd4bf/20 (teal-400 at 20%, glows and focus rings)

--color-accent:           #e879f9    (fuchsia-400, destructive actions, accent highlights)
--color-accent-dim:       #a21caf    (fuchsia-700, danger button bg on hover)

--color-success:          #4ade80    (green-400, running/active status)
--color-warning:          #fbbf24    (amber-400, in-progress/download status)
--color-danger:           #f87171    (red-400, error states)

--color-waveform-teal:    #2dd4bf    (teal-400, left/mirrored waveform trace)
--color-waveform-magenta: #e879f9    (fuchsia-400, right/mirrored waveform trace)
--color-grid-line:        #5eead4/15 (teal-300 at 15%, oscilloscope grid lines)
--color-center-axis:      #5eead4/30 (teal-300 at 30%, oscilloscope center line)
```

**Deployment rules:**
- `--color-primary` (teal) is the dominant action color. Buttons, active nav, links, focus rings — all teal.
- `--color-accent` (fuchsia/magenta) is reserved for: destructive actions (Delete, Unload), the Connect section, danger ConfirmDialog, and waveform mirror traces. It is NOT used as a secondary "nice to have" color on random badges.
- The gradient `from-teal-400 to-fuchsia-400` is used ONLY for: brand marks (logo, hero wave), the MemoryBar fill, download progress, and active-state highlights. Never on body text or backgrounds.
- All `text-gray-500` on dark backgrounds MUST be replaced with `text-gray-400`. Gray-500 (contrast ratio ~2.5:1 on gray-950) is prohibited for any text that conveys information.

### 0.2 Oscilloscope Visual Effects

These CSS-only effects sell the CRT/synthwave identity without runtime cost.

**Scanline overlay** — applied to `<main>` content area:
```css
.osc-scanlines::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 1px,
    rgba(0, 0, 0, 0.03) 1px,
    rgba(0, 0, 0, 0.03) 2px
  );
  z-index: 9999;
}
```

**Phosphor glow** — applied to active cards, active nav item, focused inputs:
```css
.osc-glow {
  box-shadow: 0 0 20px rgba(45, 212, 191, 0.08), 0 0 40px rgba(45, 212, 191, 0.04);
}
.osc-glow-active {
  box-shadow: 0 0 12px rgba(45, 212, 191, 0.15), 0 0 30px rgba(45, 212, 191, 0.08);
}
.osc-glow-accent {
  box-shadow: 0 0 12px rgba(232, 121, 249, 0.15), 0 0 30px rgba(232, 121, 249, 0.08);
}
```

**Neon border** — for the active sidebar indicator and selected cards:
```css
.osc-border-active {
  border-left: 2px solid #2dd4bf;
  box-shadow: inset 2px 0 8px rgba(45, 212, 191, 0.15);
}
```

**Waveform animation** — for the Dashboard hero and loading states:
```css
@keyframes osc-trace {
  0%, 100% { d: path("M0 16 Q8 4, 16 16 Q24 28, 32 16"); }
  50%      { d: path("M0 16 Q8 28, 16 16 Q24 4, 32 16"); }
}
```
Use `<animate>` inside SVG `<path>` elements for the waveform. No JS animation loops.

### 0.3 Typography Scale

| Token | Size | Weight | Color | Usage |
|---|---|---|---|---|
| `text-display` | `text-2xl` | `font-bold` | `text-text-primary` | Page titles ("Models", "Instances") |
| `text-heading` | `text-lg` | `font-semibold` | `text-text-primary` | Section headings ("Local Models", "Download from HuggingFace") |
| `text-subheading` | `text-sm` | `font-semibold` | `text-text-secondary` | Card titles, subsection labels |
| `text-body` | `text-sm` | `font-normal` | `text-text-primary` | All body text |
| `text-caption` | `text-xs` | `font-normal` | `text-text-secondary` | Hints, metadata, timestamps |
| `text-mono` | `text-xs` | `font-mono` | `text-text-secondary` | File paths, ports, PIDs, quantization labels |

Define these as Tailwind `@theme` utilities in `index.css` so they can be applied as `text-display`, `text-heading`, etc.

### 0.4 Spacing & Sizing Tokens

| Token | Value | Usage |
|---|---|---|
| `--space-page-x` | `1.5rem` (p-6) | Horizontal page padding |
| `--space-page-y` | `1.5rem` (p-6) | Vertical page padding |
| `--space-card-p` | `1rem` (p-4) | Card internal padding |
| `--space-section-gap` | `1.5rem` (mb-6) | Between page sections |
| `--radius-card` | `0.5rem` (rounded-lg) | Card corner radius |
| `--radius-button` | `0.375rem` (rounded-md) | Button corner radius |
| `--radius-input` | `0.375rem` (rounded-md) | Input corner radius |

---

## 1. Navigation & Shell

The sidebar is the first thing users see on every page. It must feel like part of the oscilloscope instrument panel — not a generic SaaS sidebar.

### 1.1 Redesign sidebar with icon rail, badges, and collapsed state

- **Priority**: P0
- **What**: Replace the plain-text `w-56` sidebar with a dual-mode sidebar:

  **Expanded mode** (`w-56`): Logo mark at top, then nav items stacked vertically. Each item shows icon + label. Bottom shows version number and a collapse chevron.

  **Collapsed mode** (`w-14`): Icon-only rail. Logo shrinks to just the waveform icon. Labels hidden. Tooltips on hover show the page name. Clicking the chevron at the bottom expands it back.

  **Toggle behavior**: The collapse state persists in `localStorage` key `flow.sidebar_collapsed`. Default to expanded.

  **Nav items** (top to bottom, with their specific icons):

  | Nav Item | Route | Icon (SVG concept) | Badge |
  |---|---|---|---|
  | Dashboard | `/` | Oscilloscope waveform — a simplified version of the logo mark (teal mirrored waveform, 3 peaks) | None |
  | Models | `/models` | Stacked horizontal lines (layer stack) — 3 offset rectangles suggesting neural network layers. Teal stroke, no fill. | Amber dot when downloads are in progress |
  | Instances | `/running` | Pulse dot — a circle with radiating concentric rings, like a radar ping. Teal fill. | Green pulsing dot when models are running |
  | Chat | `/chat` | Waveform bubble — a speech bubble outline with a mini waveform inside. Teal stroke, no fill. | None |
  | Telemetry | `/telemetry` | Chart trace — a line chart with 3 data points, like an ECG trace. Teal stroke, no fill. | None |
  | Settings | `/settings` | Gear with wave — a gear outline where one tooth is replaced by a small waveform peak. Teal stroke, no fill. | None |

  **Icon style spec**: All nav icons are 20x20px, drawn with `stroke-width: 1.5`, `stroke-linecap: round`, `stroke-linejoin: round`. The stroke color is `--color-text-muted` (gray-500) in inactive state and `--color-primary` (teal-400) in active state. No fill. This keeps them visually consistent — line-drawn, not filled — matching the oscilloscope trace aesthetic.

  **Active state**: The active nav item gets:
  1. A `2px` left border in teal-400 (the `osc-border-active` style)
  2. Background: `bg-teal-400/10` (teal-400 at 10% opacity)
  3. Icon stroke transitions to `--color-primary` (teal-400)
  4. Text color transitions to `text-white`
  5. The `osc-glow-active` box-shadow (subtle phosphor bloom)

  **Hover state** (inactive items): Background fades to `bg-gray-800`, text transitions to `text-gray-200`, icon stroke to `text-gray-300`. Transition duration: `150ms ease-out`.

  **Badge spec**:
  - Green pulsing dot: `w-2 h-2 rounded-full bg-green-400` with `animate-pulse`, positioned `top-1 right-1` of the icon container in collapsed mode, or `top-1 right-6` in expanded mode.
  - Amber dot (downloads): `w-2 h-2 rounded-full bg-amber-400`, static, same positioning.

  **Logo area**: Top section shows the existing SVG logo mark (the bitcrushed waveform with teal primary trace and fuchsia secondary trace) at `w-7 h-7` in expanded mode, `w-5 h-5` in collapsed. Below it in expanded mode: "Flow" in `text-lg font-bold text-white` and "macOS LLM Orchestration" in `text-xs text-text-muted`. In collapsed mode, just the icon.

  **Version footer**: Bottom section shows version in `text-xs text-text-muted` (`v0.1.0`). In collapsed mode, just a small dot.

  **Transitions**: Sidebar width transition: `transition-all duration-200 ease-out`. Icon-only to icon+label: labels fade in with `opacity 150ms`, staggered by 30ms per item for a cascading reveal effect.

- **Why**: The current sidebar is a bare list of text links with no visual identity. Custom oscilloscope-style icons, status badges, and the dual-mode layout give instant recognition and live status at a glance. The collapse/expand gives screen real estate back on smaller screens. The logo mark sets the brand tone on every page.
- **Effort**: L
- **Files**: `web/src/App.tsx`, new `web/src/components/Sidebar.tsx`, new `web/src/components/NavIcon.tsx`

### 1.2 Add a Dashboard landing page at `/`

- **Priority**: P1
- **What**: Create a new Dashboard page that renders at `/` (Models moves to `/models`). The Dashboard has three zones:

  **Hero zone** (top, ~40vh): A centered oscilloscope animation. Two `<svg>` paths — a teal trace and a fuchsia trace — mirrored across a horizontal center axis. The paths animate using `<animate>` (CSS `d` path morphing) to create a slow, breathing waveform. A faint `--color-grid-line` grid (vertical lines every 40px, horizontal every 20px) sits behind the trace. The hero shows the app name "Flow" in `text-display` and "Local LLM orchestration for Apple Silicon" in `text-caption`.

  **Status summary zone** (middle): A 4-column grid of stat cards using the `<Card>` component:
  - Models Available: count, teal icon
  - Models Running: count (with green pulse if > 0), teal icon
  - Memory Used: `X / Y GB` with the `<MemoryBar>` component (gradient variant)
  - Recent Activity: last telemetry timestamp, or "No activity yet"

  **Quick actions zone** (bottom): 3 buttons in a row: "Load a Model" (primary Button, links to `/models`), "Open Chat" (secondary Button, links to `/chat`), "View Telemetry" (ghost Button, links to `/telemetry`).

  The hero waveform must be pure SVG+CSS animation — no canvas, no JS requestAnimationFrame. The SVG should use `viewBox="0 0 400 200"` and contain ~8 peaks per trace.

- **Why**: Users currently land on the dense Models page with no orientation. A dashboard gives a "home" that answers "what's running?" immediately and guides first-time users.
- **Effort**: L
- **Files**: New `web/src/pages/Dashboard.tsx`, `web/src/App.tsx` (add route), `web/src/components/Sidebar.tsx` (add Dashboard nav item)

### 1.3 Rename "Chat Test" to "Chat" and "Running" to "Instances"

- **Priority**: P0
- **What**: In the sidebar nav labels, page headings (`<h2>`), and `<title>`, rename "Chat Test" to "Chat" and "Running" to "Instances". Update the route label text in `App.tsx` and the `<h2>` in `Chat.tsx` (line 138) and `Running.tsx` (line 16). "Chat" is shorter and clearer; "Instances" disambiguates from a generic "running" status.
- **Why**: "Chat Test" reads like an internal debug tool. "Running" is vague for new users who don't know what is running.
- **Effort**: S
- **Files**: `web/src/App.tsx`, `web/src/pages/Chat.tsx`, `web/src/pages/Running.tsx`

---

## 2. Shared Components

Without shared components, every page reinvents buttons, cards, and form fields. Build these first so all subsequent work inherits consistency.

### 2.1 Create Button, InputField, and Card components

- **Priority**: P0
- **What**: Extract three shared components:

  **`<Button>`**
  ```tsx
  interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant: 'primary' | 'secondary' | 'danger' | 'ghost'
    size: 'sm' | 'md'
  }
  ```
  - `primary`: `bg-primary-dim hover:bg-primary text-white` (teal-600/teal-500). Focus ring: `ring-2 ring-primary-glow`. Disabled: `bg-gray-700 text-gray-500 cursor-not-allowed`.
  - `secondary`: `bg-bg-elevated hover:bg-gray-600 text-text-primary border border-border`. Focus ring: `ring-2 ring-primary-glow`.
  - `danger`: `bg-accent-dim hover:bg-fuchsia-600 text-white`. Focus ring: `ring-2 ring-fuchsia-400/30`.
  - `ghost`: `bg-transparent hover:bg-bg-elevated text-text-secondary`. No border. Focus ring: `ring-2 ring-primary-glow`.
  - Sizes: `sm` = `px-3 py-1.5 text-xs`, `md` = `px-4 py-2 text-sm`.
  - All variants: `rounded-md font-medium transition-colors duration-150 focus:outline-none`.

  **`<InputField>`**
  ```tsx
  interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string
    hint?: string
    error?: string
  }
  ```
  - Wraps `<input>` and `<textarea>` with: `bg-bg-surface border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-glow focus:border-primary`.
  - If `error` is set: border becomes `border-danger`, ring becomes `ring-danger/30`.
  - `label` renders as `text-subheading mb-1`. `hint` renders as `text-caption text-text-muted mt-1`. `error` renders as `text-caption text-danger mt-1`.
  - Eliminates the `focus:ring-teal-500` / `focus:ring-fuchsia-500` copy-pasted 10+ times across pages.

  **`<Card>`**
  ```tsx
  interface CardProps {
    variant: 'default' | 'active' | 'accent' | 'danger'
    children: React.ReactNode
    className?: string
  }
  ```
  - `default`: `bg-bg-surface border border-border rounded-lg p-4`.
  - `active`: `bg-bg-surface border-l-2 border-l-primary rounded-lg p-4 osc-glow-active`.
  - `accent`: `bg-bg-surface border border-accent/30 rounded-lg p-4 osc-glow-accent`.
  - `danger`: `bg-bg-surface border border-danger/30 rounded-lg p-4`.

- **Why**: Button padding, colors, and borders are inconsistent across pages (some `bg-teal-600`, some `bg-fuchsia-600`, some `bg-gray-700`, with varying `px/py` and `rounded-md`). Input styling is copy-pasted with different ring colors. Cards use different border colors per page. Shared components enforce consistency and reduce future bugs.
- **Effort**: M
- **Files**: New `web/src/components/Button.tsx`, `web/src/components/InputField.tsx`, `web/src/components/Card.tsx`; then refactor all pages to use them

### 2.2 Create MemoryBar shared component

- **Priority**: P1
- **What**: Extract the memory bar (duplicated in `Running.tsx` line 49-58 and `Settings.tsx` line 229-238) into `<MemoryBar>`:
  ```tsx
  interface MemoryBarProps {
    used: number
    total: number
    label?: string
    variant: 'gradient' | 'solid'
  }
  ```
  - `gradient` variant: fill is `bg-gradient-to-r from-teal-400 to-fuchsia-400`, used in Running and Dashboard.
  - `solid` variant: fill is `bg-primary-dim` (teal-600), used in Settings.
  - Track: `w-full bg-bg-elevated rounded-full h-3`.
  - Below the bar: `text-caption` showing `{percentage}% used — {available} GB available`.
  - Animate width changes with `transition-all duration-500 ease-out`.
  - Apply `osc-glow` to the fill bar for the phosphor bloom effect.

- **Why**: The memory bar is duplicated between Running and Settings with different styling. A shared component ensures consistency and makes the waveform style reusable.
- **Effort**: S
- **Files**: New `web/src/components/MemoryBar.tsx`, `web/src/pages/Running.tsx`, `web/src/pages/Settings.tsx`

### 2.3 Create StatusBadge component

- **Priority**: P1
- **What**:
  ```tsx
  interface StatusBadgeProps {
    status: 'running' | 'available' | 'loading' | 'error'
    detail?: string  // e.g. ":8080" for running models
  }
  ```
  - `running`: Green dot (`w-2 h-2 rounded-full bg-success`) + `animate-pulse` + "Running" text in `text-success`, plus `detail` in `text-mono`. Example output: `[green dot] Running :8080`
  - `available`: Teal outline pill. `border border-primary/50 text-primary text-xs px-1.5 py-0.5 rounded font-mono`. Text: "Available".
  - `loading`: Amber pulse dot + "Loading..." in `text-warning`.
  - `error`: Fuchsia text. `text-accent text-xs`. Text: the `detail` string or "Error".

  Replace all inline badge patterns in Models.tsx (lines 220-228, 234-254) and Running.tsx (lines 77-78) with this component.

- **Why**: Currently "Running :8080" is a plain green-tinted pill, "GGUF"/"MLX" badges use different color logic, and "template error" is just red text. A unified badge system makes status scannable at a glance.
- **Effort**: S
- **Files**: New `web/src/components/StatusBadge.tsx`, `web/src/pages/Models.tsx`, `web/src/pages/Running.tsx`

---

## 3. Critical Bug Fixes

### 3.1 Add onClick handler to Unload button on Running page

- **Priority**: P0
- **What**: The Unload button in Running.tsx (line 94) has no `onClick` handler. Add `onClick={() => unloadMut.mutate(m.model_id)}` and wire up a `useMutation` for the unload API call. The mutation already exists in Models.tsx but is missing from Running.tsx. Also add a loading state: when `unloadMut.isPending`, show "Unloading..." and set `disabled`. On error, show an inline error message.
- **Why**: The button is completely non-functional. Users see "Unload" but clicking it does nothing.
- **Effort**: S
- **Files**: `web/src/pages/Running.tsx`

### 3.2 Replace chat input with multi-line textarea

- **Priority**: P0
- **What**: In Chat.tsx (line 230), replace the `<input type="text">` with a `<textarea>` that auto-resizes from 1 to 6 rows. Implementation:
  - Use a `ref` callback that sets `textarea.style.height = 'auto'` then `textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px'` on every input change.
  - Enter sends the message (call `sendMessage()`). Shift+Enter inserts a newline (`\n`).
  - The textarea should use the `InputField` component styling: `bg-bg-surface border-border rounded-md`, with the `osc-glow` focus state.
  - Max height: 6 rows (~150px). After that, the textarea scrolls internally.
- **Why**: A single-line input prevents multi-line prompts, which are common for LLM interaction. This is a fundamental usability blocker for a chat interface.
- **Effort**: S
- **Files**: `web/src/pages/Chat.tsx`

---

## 4. Interaction Polish

### 4.1 Add download progress indicators for HuggingFace downloads

- **Priority**: P0
- **What**: Poll the `/api/downloads` endpoint (already exists as `api.getDownloads()`) on a 2-second interval while any download is active. Render a `<DownloadProgress>` component inside each downloading model card showing:
  - Progress bar: `w-full bg-bg-elevated rounded-full h-2` track, with a `bg-gradient-to-r from-primary to-accent` fill bar. Width = `(bytes_downloaded / total_bytes) * 100%`.
  - Percentage text: `text-caption` showing `34% — 2.1 GB / 6.2 GB`.
  - Indeterminate state: If `total_bytes` is null/unknown, show a pulsing animation instead of a percentage. Use `@keyframes pulse-bar { 0% { width: 30%; margin-left: 0; } 50% { width: 60%; margin-left: 20%; } 100% { width: 30%; margin-left: 0; } }`.
  - When complete: Auto-refresh the models list via `queryClient.invalidateQueries({ queryKey: ['models'] })`.
  - Track active downloads in component state as a `Map<hfId, DownloadProgress>`.

- **Why**: Downloads can take 5-30+ minutes for large models. Currently there is zero feedback after clicking "Download" — the button just says "Downloading..." indefinitely. Users have no way to know if the download is progressing, stalled, or failed.
- **Effort**: M
- **Files**: `web/src/pages/Models.tsx`, new `web/src/components/DownloadProgress.tsx`, `web/src/api/client.ts` (may need typed download-progress response)

### 4.2 Replace window.confirm() with a ConfirmationDialog component

- **Priority**: P0
- **What**: Create a `<ConfirmationDialog>` modal:
  ```tsx
  interface ConfirmationDialogProps {
    title: string
    message: string
    confirmLabel?: string
    variant: 'danger' | 'default'
    onConfirm: () => void
    onCancel: () => void
  }
  ```
  - Backdrop: `fixed inset-0 bg-black/60 z-50` with `osc-scanlines` overlay.
  - Dialog card: `bg-bg-surface border border-border rounded-xl p-6 w-[min(420px,calc(100vw-2rem))]`.
  - `danger` variant: Confirm button uses `Button variant="danger"`. Title has a fuchsia left-border accent. Icon: a triangle warning icon in `text-accent` above the title.
  - `default` variant: Confirm button uses `Button variant="primary"`.
  - Cancel button: `Button variant="ghost"`.
  - Focus trap: Tab/Shift+Tab cycle only inside the dialog. Escape calls `onCancel()`.
  - Replace the `confirm()` call in Models.tsx line 258: `if (confirm('Delete ${m.name}?'))` becomes `<ConfirmationDialog title="Delete Model" message="This will permanently delete the model files from disk. This cannot be undone." confirmLabel="Delete" variant="danger" onConfirm={() => deleteMut.mutate(m.id)} onCancel={() => setShowDeleteDialog(false)} />`.

- **Why**: `window.confirm()` is a browser-native dialog that breaks the visual identity and is easy to dismiss accidentally. A custom dialog matches the synthwave theme, provides descriptive copy, and has a clear destructive action button.
- **Effort**: S
- **Files**: New `web/src/components/ConfirmationDialog.tsx`, `web/src/pages/Models.tsx`

### 4.3 Add a Toast / Notification system

- **Priority**: P0
- **What**: Create a `<ToastProvider>` and `useToast()` hook. Usage: `const toast = useToast(); toast.success('Model loaded'); toast.error('Download failed: network error'); toast.info('Scan found 3 models');`.

  Toast stack:
  - Position: bottom-right, `fixed bottom-4 right-4 z-[100]`.
  - Stack: vertically, newest on top, max 3 visible. Older toasts slide down and fade out.
  - Auto-dismiss after 4 seconds. A thin progress bar at the bottom of each toast counts down (teal for success, fuchsia for error, gray for info).
  - Variants:
    - `success`: `border-l-2 border-l-primary bg-bg-surface`, teal checkmark icon.
    - `error`: `border-l-2 border-l-danger bg-bg-surface`, fuchsia X icon.
    - `info`: `border-l-2 border-l-text-muted bg-bg-surface`, gray info icon.
  - Each toast: `rounded-md shadow-lg osc-glow` padding, `text-body` message.
  - Add to all async operations: model load/unload, download complete/failed, settings saved, scan complete (with count).

- **Why**: Currently all feedback is inline text ("Saved!", "Connected!") that users easily miss. A toast system provides consistent, non-intrusive feedback for all async operations.
- **Effort**: M
- **Files**: New `web/src/components/Toast.tsx`, `web/src/App.tsx` (wrap in ToastProvider), then add toast calls to Models.tsx, Running.tsx, Chat.tsx, Settings.tsx

### 4.4 Add conversation clear action to Chat

- **Priority**: P1
- **What**: Add a "Clear" button next to the Chat heading (line 138) that resets `messages` state to `[]` and clears any `error` state. Use `Button variant="ghost" size="sm"`. Place it in the header row: `<h2>Chat</h2>` ... `<Button variant="ghost" size="sm">Clear</Button>`.
- **Why**: Users currently have no way to reset the conversation without refreshing the page. This is a basic chat UX expectation.
- **Effort**: S
- **Files**: `web/src/pages/Chat.tsx`

### 4.5 Make HuggingFace search results keyboard-navigable

- **Priority**: P1
- **What**: Add `role="listbox"` to the search results container (`<div>` around line 295) and `role="option"` to each result item. Track `focusedIndex` state (default -1). On `onKeyDown` on the search input:
  - ArrowDown: `focusedIndex = Math.min(focusedIndex + 1, results.length - 1)`
  - ArrowUp: `focusedIndex = Math.max(focusedIndex - 1, -1)`
  - Enter when `focusedIndex >= 0`: select that result (call `setSelectedModel`)
  - Escape: close results (clear `searchResults`)
  - Scroll the focused item into view with `scrollIntoView({ block: 'nearest' })`.
  - Visual focus: `focusedIndex === i ? 'ring-2 ring-primary border-primary bg-bg-hover' : 'border-border'`.
- **Why**: Search results are click-only, which is slow for power users and fails accessibility requirements.
- **Effort**: M
- **Files**: `web/src/pages/Models.tsx`

### 4.6 Add focus trap and Escape handling to LoadDialog

- **Priority**: P1
- **What**: When LoadDialog is open (line 43-175):
  - Trap focus: On mount, query all `a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])` inside the dialog. On Tab, cycle to next. On Shift+Tab, cycle to previous. If focus would leave the dialog, wrap to first/last focusable element.
  - Escape: `useEffect` adding a `keydown` listener for `Escape` that calls `onClose()`. Clean up on unmount.
  - Restore focus: `useEffect` that saves `document.activeElement` on mount and restores it on unmount (`element.focus()`).
  - Also add `aria-modal="true"` and `aria-label="Load model"` to the dialog div.
- **Why**: Modal dialogs without focus traps are an accessibility violation. Users can Tab into the background, which is disorienting. Escape to close is a basic expectation.
- **Effort**: M
- **Files**: `web/src/components/LoadDialog.tsx`

---

## 5. Visual Hierarchy & Layout

### 5.1 Restructure Models page: move Register/Connect into collapsible sections

- **Priority**: P0
- **What**: Move "Register Existing Model" (lines 138-166) and "Connect Running Model" (lines 168-198) into collapsible `<details>` elements (native HTML, no JS needed). Both default to collapsed. Structure:

  ```
  [Local Models section]          ← primary, always visible
  [HuggingFace search section]   ← primary, always visible
  <details>                      ← collapsed by default
    <summary>Advanced: Register & Connect</summary>
    [Register form]
    [Connect form]
  </details>
  ```

  Style the `<summary>` as a `text-subheading text-text-secondary cursor-pointer hover:text-text-primary` with a chevron icon that rotates on open. The "Advanced" label signals these are power-user features.

  Remove the Connect section's `border-fuchsia-900/30` and `text-fuchsia-300` styling since it no longer needs to shout for attention in the collapsed state.

- **Why**: These two forms steal visual priority from the primary tasks (browsing models, searching HuggingFace). New users are confused by path inputs before they even have context. Collapsing them reduces cognitive load by ~60%.
- **Effort**: M
- **Files**: `web/src/pages/Models.tsx`

### 5.2 Improve empty states with guided actions

- **Priority**: P1
- **What**: Replace all bare-text empty states with illustrated empty states using a shared `<EmptyState>` component:
  ```tsx
  interface EmptyStateProps {
    title: string
    description: string
    action?: { label: string; onClick: () => void } | { label: string; linkTo: string }
    illustration: 'models' | 'instances' | 'chat' | 'telemetry'
  }
  ```

  The `illustration` prop selects a small SVG oscilloscope-style illustration:
  - `models`: A flatline waveform with a download arrow
  - `instances`: A flatline waveform with a power symbol
  - `chat`: A speech bubble with a flatline inside
  - `telemetry`: An empty chart trace

  All illustrations use teal stroke, no fill, `w-16 h-16` centered.

  Specific instances:
  - Models: title "No models yet", description "Download your first model from HuggingFace or register a local GGUF file.", action "Browse HuggingFace" (scrolls to search section).
  - Instances: title "No models running", description "Load a model to get started.", action "Go to Models" (`<Link to="/models">`).
  - Chat: title "Select a model to start chatting", description "Choose a running model from the dropdown.", no action button (the model selector is right there).
  - Telemetry: title "No telemetry data yet", description "Send requests through the proxy to see stats.", no action.

- **Why**: Empty states are the first thing new users see. A dead-end "No models yet" with no action path creates friction. Guided empty states turn dead ends into next steps.
- **Effort**: M
- **Files**: `web/src/pages/Models.tsx`, `web/src/pages/Running.tsx`, `web/src/pages/Chat.tsx`, `web/src/pages/Telemetry.tsx`, new `web/src/components/EmptyState.tsx`

### 5.3 Make "go to Models" link clickable on Running page

- **Priority**: P0
- **What**: On Running.tsx line 67, change `No models running. Load a model from the Models page.` to: `No models running. <Link to="/models" className="text-primary hover:text-white underline">Go to Models</Link>`. Also change the route from `/` to `/models` once the Dashboard is in place (see 1.2).
- **Why**: The current text says "go to Models page" but is not clickable. This is a UX dead end.
- **Effort**: S
- **Files**: `web/src/pages/Running.tsx`

---

## 6. Error Handling & Resilience

### 6.1 Humanize API error messages

- **Priority**: P1
- **What**: Create a `formatError(err: unknown): string` utility in `web/src/utils/errors.ts`. Map common patterns:
  - `404` / `not found` -> "Model not found. It may have been deleted."
  - `503` / `Service Unavailable` -> "The server is temporarily unavailable. Please try again in a moment."
  - `500` / `Internal Server Error` -> "Something went wrong on the server. Please try again."
  - `Failed to fetch` / `NetworkError` -> "Cannot connect to the server. Is Flow running?"
  - `429` / `rate limit` -> "Too many requests. Please wait a moment and try again."
  - Fallback: "An unexpected error occurred. Please try again."

  Use in all error displays: Chat.tsx, Models.tsx, LoadDialog.tsx, Running.tsx, Settings.tsx. Replace raw `(error as Error).message` with `formatError(error)`.

- **Why**: Raw API errors like "API error 500: Internal Server Error" are scary and unhelpful. Users need to know (1) what happened, (2) whether they can fix it, (3) what to do next.
- **Effort**: S
- **Files**: New `web/src/utils/errors.ts`, `web/src/pages/Models.tsx`, `web/src/pages/Chat.tsx`, `web/src/components/LoadDialog.tsx`, `web/src/pages/Running.tsx`, `web/src/pages/Settings.tsx`

### 6.2 Add backend disconnected banner

- **Priority**: P1
- **What**: Create a `<ConnectionBanner>` component. Use `api.getHealth()` (already exists) with `refetchInterval: 5000` and `retry: 2`. When the query fails (isError), render a full-width banner at the top of `<main>`:
  ```
  <div className="bg-danger/10 border-b border-danger/30 text-danger px-4 py-2 text-sm flex items-center gap-2">
    <AlertTriangleIcon /> Flow server disconnected. Reconnecting...
  </div>
  ```
  Auto-dismiss when the health check succeeds again. Use `animate-pulse` on "Reconnecting...".

  Add this to `App.tsx` as a wrapper inside `<main>`, above the `<Routes>`.

- **Why**: If the backend crashes or is restarted, the UI silently breaks. Users see stale data or cryptic errors. A visible banner makes the state obvious and reassures users the app is trying to recover.
- **Effort**: M
- **Files**: `web/src/App.tsx`, new `web/src/components/ConnectionBanner.tsx`

### 6.3 Add download failure recovery with retry

- **Priority**: P1
- **What**: When a download mutation fails (`downloadMut.onError`):
  1. Show a toast: `toast.error('Download failed: ${formatError(err)}')` with a "Retry" action button.
  2. The toast's "Retry" button re-triggers `downloadMut.mutate({ hfId, filename })` with the same parameters.
  3. Track failed downloads in state: `const [failedDownloads, setFailedDownloads] = useState<Map<string, { hfId: string; filename?: string }>>(new Map())`.
  4. In the model list, show a "Retry" button inline next to failed downloads (using the StatusBadge component with `status="error"`).

- **Why**: Downloads fail frequently (network issues, disk space, HuggingFace rate limits). Currently the button just stops showing "Downloading..." and the user has to manually re-search and re-initiate. Retry should be one click.
- **Effort**: M
- **Files**: `web/src/pages/Models.tsx`, `web/src/components/Toast.tsx`

### 6.4 Show scan results feedback

- **Priority**: P1
- **What**: After the scan mutation succeeds, show a toast:
  - If `data.found.length > 0`: `toast.success('Found ${data.found.length} new model${data.found.length > 1 ? "s" : ""}')`
  - If `data.found.length === 0`: `toast.info('No new models found')`

  The API already returns `{ found: any[], total: number }` from `scanMut.data`.

- **Why**: Currently the scan button changes to "Scanning..." then back with no feedback. Users don't know if it found anything.
- **Effort**: S
- **Files**: `web/src/pages/Models.tsx`

---

## 7. Onboarding

### 7.1 Add a first-run onboarding flow

- **Priority**: P1
- **What**: When the app loads for the first time (check `localStorage.getItem('flow.onboarding_complete')`), show a 3-step onboarding overlay:

  **Step 1 — Welcome**: "Welcome to Flow" in `text-display`, with the oscilloscope logo animation (same SVG as sidebar, but larger, `w-24 h-24`). Subtext: "Local LLM orchestration for Apple Silicon." A "Get Started" primary button and "Skip" ghost button.

  **Step 2 — Download a Model**: "Find and download models from HuggingFace" in `text-heading`. A miniature illustration of the HuggingFace search interface. A "Go to Models" primary button (links to `/models`).

  **Step 3 — Start Chatting**: "Load a model and start chatting" in `text-heading`. A miniature illustration of the Chat interface. A "Open Chat" primary button (links to `/chat`).

  **Implementation details**:
  - Overlay: `fixed inset-0 bg-black/80 z-50 flex items-center justify-center` with `osc-scanlines` overlay.
  - Card: `bg-bg-surface border border-border rounded-xl p-8 max-w-md` with `osc-glow`.
  - Step indicator: 3 dots at the bottom. Active step: `w-6 h-2 bg-primary rounded-full`. Inactive: `w-2 h-2 bg-text-muted rounded-full`.
  - On finish or skip: `localStorage.setItem('flow.onboarding_complete', 'true')`.
  - Add a "Restart onboarding" option in Settings.

- **Why**: First-time users see a dense Models page with no models and no guidance. Onboarding gives them a path from zero to value.
- **Effort**: L
- **Files**: New `web/src/components/Onboarding.tsx`, `web/src/App.tsx`

### 7.2 Add tooltips for technical settings

- **Priority**: P2
- **What**: Create a `<Tooltip>` component:
  ```tsx
  interface TooltipProps {
    content: string
    children: React.ReactNode
  }
  ```
  - On hover, show a `bg-bg-elevated border border-border rounded-md px-3 py-2 text-caption text-text-primary shadow-lg max-w-xs` tooltip above the trigger element.
  - Arrow: a small CSS triangle pointing down from the tooltip to the trigger.
  - Delay: 300ms before showing, instant hide on mouse leave.
  - Apply `osc-glow` to the tooltip for the phosphor bloom.

  Add tooltips to these Settings fields:
  - Context Window: "The maximum number of tokens the model can see at once. Larger values allow longer conversations but use more memory."
  - KV Cache Quantization: "Compresses the key-value cache to save memory. q4_0 is recommended for most use cases on Apple Silicon."
  - GPU Layers: "-1 offloads all layers to the Metal GPU. This is optimal for Apple Silicon."
  - Parallel Slots: "Concurrent request slots for multi-turn agent conversations. More slots use more memory."

  Also add tooltips to the LoadDialog for the same fields.

- **Why**: Settings like "cache_type_k" and "n_parallel" are opaque to anyone who isn't an ML engineer. Tooltips provide just-in-time education without cluttering the UI.
- **Effort**: M
- **Files**: New `web/src/components/Tooltip.tsx`, `web/src/pages/Settings.tsx`, `web/src/components/LoadDialog.tsx`

---

## 8. Mobile / Responsive

### 8.1 Add responsive sidebar with hamburger toggle

- **Priority**: P1
- **What**: On screens `< 768px` (Tailwind `md:` breakpoint):
  - Hide the sidebar completely (`hidden md:flex`).
  - Show a top bar (`h-12 bg-bg-surface border-b border-border flex items-center px-4 md:hidden`) with: hamburger button (three horizontal lines, teal stroke, `w-6 h-6`), the Flow logo mark (`w-5 h-5`), and "Flow" in `text-heading`.
  - Tapping hamburger opens the sidebar as a full-height overlay (`fixed inset-y-0 left-0 w-64 bg-bg-surface z-50 shadow-2xl osc-glow`). Tapping a nav item or tapping outside closes it.
  - On desktop (`>= 768px`): show the sidebar normally with the collapse/expand from 1.1.

- **Why**: The current sidebar is fixed at `w-56` with no mobile adaptation. On any screen under ~900px, the main content is squeezed into a narrow strip. A responsive sidebar is table stakes for any modern app.
- **Effort**: M
- **Files**: `web/src/App.tsx`, `web/src/components/Sidebar.tsx`

### 8.2 Make Models page responsive

- **Priority**: P2
- **What**: On mobile (`< 768px`):
  - Stack the Register and Connect forms vertically (they're already in a flex row, just ensure they wrap).
  - Make model cards full-width (`w-full` instead of relying on `max-w-6xl`).
  - Stack the HF search bar + button vertically.
  - Replace `max-w-6xl` with `max-w-full` on the outer container.
  - Ensure the model detail card scrolls properly (add `overflow-x-auto` to the container).

- **Why**: Fixed-width elements overflow on small screens. The page is unusable below ~1024px.
- **Effort**: M
- **Files**: `web/src/pages/Models.tsx`

### 8.3 Make Chat page responsive

- **Priority**: P2
- **What**: On mobile:
  - Stack the model selector and tool-calling checkbox vertically.
  - Make the chat message area use `h-[100dvh]` (dynamic viewport height) to account for mobile browser chrome.
  - Ensure the input area is always visible above the keyboard: use `flex-shrink-0` on the input container and `flex-1 overflow-y-auto` on the messages area.
  - Add `pb-safe` bottom padding (or `env(safe-area-inset-bottom)`) for iPhone notch.

- **Why**: Chat is the most likely page to be used on a tablet/phone and currently has no responsive handling.
- **Effort**: S
- **Files**: `web/src/pages/Chat.tsx`

### 8.4 Make LoadDialog responsive

- **Priority**: P2
- **What**: Change the dialog width from `w-[480px]` to `w-[min(480px,calc(100vw-2rem))]`. On very short viewports (< 600px height), add `max-h-[90vh] overflow-y-auto` (which it already has). Test on 375px-wide viewport (iPhone SE).
- **Why**: Fixed 480px width overflows on phones (375px viewport).
- **Effort**: S
- **Files**: `web/src/components/LoadDialog.tsx`

---

## 9. Accessibility

### 9.1 Add ARIA labels to all interactive elements

- **Priority**: P1
- **What**: Add `aria-label` to:
  - All icon-only buttons: Refresh, Delete, Unload, the sidebar collapse chevron
  - Nav links: `aria-label="Models — browse and download models"` etc.
  - Form inputs without visible `<label>` elements: add `aria-label` or wrap with `<label>`
  - Status badges: `aria-label="Status: Running on port 8080"` etc.
  - The search results list: `role="listbox"` and each result: `role="option"` (see 4.5)
  - Add `aria-live="polite"` to: the chat message area, download progress indicators, the toast container
  - Add `aria-live="assertive"` to: error messages that appear inline

- **Why**: Screen readers currently announce buttons as unnamed elements. Dynamic content changes (new messages, downloads) are not announced.
- **Effort**: M
- **Files**: All page files, `web/src/components/Sidebar.tsx`, `web/src/components/LoadDialog.tsx`

### 9.2 Fix color contrast for gray-500 on dark backgrounds

- **Priority**: P0
- **What**: Audit all uses of `text-gray-500` on `bg-gray-950` / `bg-gray-900` / `bg-gray-800` backgrounds. The contrast ratio is ~2.5:1, which fails WCAG AA (requires 4.5:1 for normal text). Replace with `text-gray-400` (4.6:1 on gray-950) for all text that conveys meaningful information. Reserve `text-gray-500` only for truly decorative text paired with a higher-contrast label (e.g., a dim timestamp next to a bright name).

  Specific instances to fix (non-exhaustive — audit all files):
  - Running.tsx line 32, 37, 41, 44: hardware labels ("Chip", "Total RAM", etc.)
  - Running.tsx line 58: memory bar label
  - Settings.tsx line 59, 88-89, 106-108, 125, 161-163, 178: field hint text
  - Models.tsx line 148-149: input placeholders
  - Telemetry.tsx: timestamp cells

- **Why**: Multiple pages use gray-500 text on dark backgrounds for important information (port numbers, file paths, status text). This fails accessibility standards and is hard to read even for sighted users.
- **Effort**: S
- **Files**: `web/src/pages/Models.tsx`, `web/src/pages/Running.tsx`, `web/src/pages/Chat.tsx`, `web/src/pages/Settings.tsx`, `web/src/pages/Telemetry.tsx`

### 9.3 Add skip-navigation link

- **Priority**: P2
- **What**: Add as the first element inside `<div className="flex h-screen">`:
  ```html
  <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded">
    Skip to main content
  </a>
  ```
  Add `id="main-content"` to the `<main>` element.

- **Why**: Keyboard users currently must Tab through all 5+ nav items before reaching the content. A skip link is a basic accessibility requirement.
- **Effort**: S
- **Files**: `web/src/App.tsx`

---

## 10. Naming Consistency

### 10.1 Replace all legacy brand references with "Flow"

- **Priority**: P0
- **What**: Search and replace all remaining legacy brand references in the UI codebase so public-facing strings consistently use `Flow` or `Flow LLM`. Verify the OpenClaw config example, page copy, and app metadata all match the final brand.
- **Why**: The brand is Flow LLM. Showing stale legacy naming in Settings or the OpenClaw config is confusing and unprofessional.
- **Effort**: S
- **Files**: `web/src/pages/Settings.tsx`

---

## Implementation Priority Order

### Sprint 1 — Must-do for launch (P0 items)

These are ordered by dependency chain and then by impact. Items 2.1 and 2.2 should be done first because all subsequent visual work depends on them.

| Order | # | Item | Effort | Rationale |
|---|---|------|--------|-----------|
| 1 | 10.1 | Legacy brand cleanup | S | Small copy pass, unblocks brand consistency |
| 2 | 3.1 | Fix Unload onClick | S | Critical bug, button does nothing |
| 3 | 3.2 | Chat textarea | S | Critical UX, can't type multiline |
| 4 | 5.3 | Clickable "Models" link | S | Dead-end fix, 5-minute change |
| 5 | 9.2 | Fix gray-500 contrast | S | Accessibility compliance, global find-replace |
| 6 | 1.3 | Rename Chat/Instances | S | 5-minute nav label change |
| 7 | 2.1 | Color token system | M | Foundation — all visual work depends on this |
| 8 | 2.2 (Buttons) | Button component | S | Extract from token system, needed by every page |
| 9 | 2.2 (Cards/Inputs) | Card + InputField components | M | Needed by every page, blocks form restyling |
| 10 | 4.2 | ConfirmationDialog | S | Replaces `window.confirm()`, uses Button/Cards |
| 11 | 4.3 | Toast system | M | Needed before we can add feedback for all operations |
| 12 | 4.1 | Download progress | M | Long-running op has zero feedback |
| 13 | 5.1 | Collapse Register/Connect | M | Page hierarchy fix, reduces cognitive load |
| 14 | 1.1 | Sidebar redesign with icons/badges | L | Highest visual impact, sets brand tone |

### Sprint 2 — High-impact polish (P1 items)

| Order | # | Item | Effort |
|---|---|------|--------|
| 15 | 2.2 | MemoryBar component | S |
| 16 | 2.3 | StatusBadge component | S |
| 17 | 6.1 | Humanize error messages | S |
| 18 | 6.4 | Scan results feedback | S |
| 19 | 4.4 | Chat clear button | S |
| 20 | 2.3 | Typography scale | S |
| 21 | 5.2 | Guided empty states | M |
| 22 | 6.2 | Backend disconnected banner | M |
| 23 | 6.3 | Download retry | M |
| 24 | 4.5 | Keyboard-navigable search | M |
| 25 | 4.6 | LoadDialog focus trap | M |
| 26 | 9.1 | ARIA labels | M |
| 27 | 8.1 | Responsive sidebar | M |
| 28 | 1.2 | Dashboard landing page | L |
| 29 | 7.1 | First-run onboarding | L |

### Sprint 3 — Nice to have (P2 items)

| # | Item | Effort |
|---|------|--------|
| 2.5 | CRT scanline/glow effects | S |
| 7.2 | Settings tooltips | M |
| 8.2 | Models responsive | M |
| 8.3 | Chat responsive | S |
| 8.4 | LoadDialog responsive | S |
| 9.3 | Skip-navigation link | S |

---

## Effort Estimate Rationale

- **S** (Small): Under 1 hour. Single file, single component, or find-and-replace. The change is clear and requires no new architecture.
- **M** (Medium): 1-4 hours. Multiple files, new component with moderate state management, or cross-cutting refactor. Clear spec, but implementation requires wiring up queries, state, and edge cases.
- **L** (Large): 4-8+ hours. New page, new animation system, or multi-component feature with design decisions during implementation. The Dashboard and Onboarding are L because they involve new routes, state, and visual design that must be iterated on.

---

## New Files to Create

| File | Purpose |
|---|---|
| `web/src/components/Sidebar.tsx` | Icon rail + collapsible sidebar with oscilloscope logo |
| `web/src/components/NavIcon.tsx` | Custom SVG nav icons in waveform style |
| `web/src/components/Button.tsx` | Shared button with 4 variants + 2 sizes |
| `web/src/components/InputField.tsx` | Shared input/textarea with label/hint/error |
| `web/src/components/Card.tsx` | Shared card with 4 variants |
| `web/src/components/MemoryBar.tsx` | Reusable memory progress bar (gradient/solid) |
| `web/src/components/StatusBadge.tsx` | Running/available/loading/error badges |
| `web/src/components/Toast.tsx` | Toast notification provider + hook |
| `web/src/components/ConfirmationDialog.tsx` | Confirm modal for destructive actions |
| `web/src/components/DownloadProgress.tsx` | Download progress bar with polling |
| `web/src/components/EmptyState.tsx` | Illustrated empty state with CTA |
| `web/src/components/ConnectionBanner.tsx` | Backend disconnected banner |
| `web/src/components/Tooltip.tsx` | Hover tooltip for settings fields |
| `web/src/components/Onboarding.tsx` | First-run onboarding overlay |
| `web/src/pages/Dashboard.tsx` | Dashboard landing page with oscilloscope hero |
| `web/src/utils/errors.ts` | Error message formatter |
| `web/src/theme.ts` | Color/typography/spacing tokens (or in index.css `@theme` block) |
