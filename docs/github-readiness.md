# GitHub Readiness Checklist

What needs to happen before this repo is ready to share publicly.

---

## 1. Git Cleanup

### .gitignore expansion
Current `.gitignore` is too thin (5 lines). Needs to cover:
- `*.pyc`, `*.pyo`
- `__pycache__/` (all levels)
- `*.egg-info/`
- `.env`, `.env.*`
- `.flow.pid`
- `server/logs/`
- `web/dist/`
- `web/node_modules/`
- `.vscode/`
- `.DS_Store`
- `*.db` (SQLite databases — `~/.flow/flow.db` is the runtime one)
- `.claude/` (Claude Code project settings)

### Remove tracked artifacts
These are currently in git and need `git rm --cached`:
- `server/flow_llm/__pycache__/` — Python bytecode cache
- `server/*.egg-info/` — build metadata
- `.flow.pid` — runtime PID file
- `server/logs/` — runtime log output

### Remove or relocate stray files
- `gemma4.sh` — now generic, but still optional because Flow manages model loading in the UI.
- `.vscode/launch.json` — personal debug config. Could keep as a convenience but add to `.gitignore`.

---

## 2. Hardcoded Personal Paths

### config.py — external SSD detection
```python
# Preferred: FLOW_MODELS_DIR override
# Fallback: default to ~/.flow/models, then optionally discover /Volumes/*/llms
```
**Status:** Fixed — no personal mount point remains in code.

### gemma4.sh — example model path
```
MODEL="${MODEL_PATH:-}"
```
**Status:** Fixed — `MODEL_PATH` or `-m` is required; no personal path remains.

---

## 3. Naming Consistency

The project has a split identity:

| Context | Current Name | Should Be |
|---------|-------------|-----------|
| Python package dir | `server/flow_llm/` | Good |
| Python module import | `flow_llm.main` | Good |
| pyproject.toml name | `flow-llm` | Good |
| UI display name | "Flow LLM" | Good |
| PID file | `.flow.pid` | Good |
| Data directory | `~/.flow/` | Good |
| CLI command | `flow` | Good |

**Status:** Fixed — the codebase now uses `flow_llm`, `.flow`, and `flow`.

---

## 4. Setup / Bootstrap Script

Write `setup.sh` that checks and installs all dependencies, similar to how Claude Code or OpenClaw does it.

### What it should check
- Python 3.11+ (`python3 --version`)
- Node.js 18+ (`node --version`)
- `llama-server` on PATH (if missing: `brew install llama.cpp`)
- `mlx-openai-server` on PATH (optional, warn if missing)
- `pip install -e .` for server Python deps
- `cd web && npm install` for frontend deps

### What it should build
- `cd web && npm run build` so the backend can serve the frontend statically

### What it should NOT do
- Install Homebrew itself (assume it or prompt)
- Download models (that's Flow's job via the UI)
- Start the server (that's `flow` or `./start.sh`)

### Companion: curl-based install
A one-liner for the README:
```bash
curl -fsSL https://raw.githubusercontent.com/<user>/flow-llm/main/setup.sh | bash
```

---

## 5. CLI Entry Point

Add to `pyproject.toml`:
```toml
[project.scripts]
flow = "flow_llm.main:main"
```

After `pip install -e .`, users can run `flow` to start the server.

Also keep `start.sh` aligned with the public module name (`flow_llm.main`) or the `flow` console script.

---

## 6. README Polish

The current README works but needs updates:
- Remove hardcoded local clone paths — use generic repo-relative or absolute examples
- Remove the `curl` example with a personal SSD path
- Add the one-liner setup command
- Update "Quick Start" to use `flow` command
- Add a screenshot or GIF of the UI
- Add a "What it does" section for people who don't know what OpenClaw is
- Update architecture link to `docs/architecture.md`

---

## 7. LICENSE

No license file exists. Need to add one. Common choices:
- **MIT** — most permissive, standard for developer tools
- **Apache 2.0** — like MIT but with patent clause
- **AGPL** — if you want to require open-sourcing of derivatives

MIT is the default recommendation for this kind of project.

---

## 8. Delete or Clean Internal-Only Files

| File | Action |
|------|--------|
| `docs/changelog.md` | Keep — useful development history |
| `docs/openclaw-architecture-plan.md` | Keep — useful design context |
| `docs/ux-redesign-plan.md` | Keep — useful design context |
| `docs/onboarding.md` | Keep — essential for contributors/agents |
| `docs/architecture.md` | Keep — essential reference |
| `docs/project.md` | Keep — shows phased plan |
| `docs/todo.md` | Keep — shows what's left |
| `gemma4.sh` | Delete or move to `examples/` with generic paths |

---

## 9. Final Pre-Push Checklist

Before pushing to GitHub:

- [ ] `.gitignore` expanded and all artifacts removed from tracking
- [ ] No hardcoded personal paths in any committed file
- [ ] `setup.sh` written and tested on a clean machine
- [ ] `flow` CLI entry point works
- [ ] README updated with correct install instructions
- [ ] LICENSE file added
- [ ] `git rm --cached` all artifacts (`__pycache__`, `.egg-info`, `.flow.pid`, `server/logs/`)
- [ ] Verify `npm run build` produces working `web/dist/`
- [ ] Verify `pip install -e . && flow` starts the server
- [ ] Verify the frontend loads at `http://localhost:3377`
- [ ] No secrets, API keys, or personal data in git history
- [ ] Branch is clean (`git status` shows nothing unexpected)

---

## Priority Order

1. **Expand .gitignore** + `git rm --cached` artifacts — quick, no code changes
2. **Remove personal paths** from `config.py` and `gemma4.sh` — small code change
3. **Write `setup.sh`** — new file, no existing code touched
4. **Add CLI entry point** — tiny `pyproject.toml` change
5. **Polish README** — doc changes only
6. **Add LICENSE** — single file
7. **Review renamed runtime defaults** — verify `.flow`, `.flow.pid`, and `flow_llm` work end-to-end
8. **Optional package polish** — add any remaining packaging or setup niceties after the rename
