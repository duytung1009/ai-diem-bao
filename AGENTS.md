# AGENTS.md

> **All project rules are defined in `CLAUDE.md` — read that file first before taking any action.**

This file exists so that agents following the AGENTS.md convention (OpenCode, etc.) know where to find the canonical instructions. The single source of truth for this project is `CLAUDE.md`.

## Critical rules (summary — full detail in CLAUDE.md)

- **Before any code change, ALWAYS check task-master first** — run `task-master list` and `task-master next` to understand current task context
- **Verify with `npm run compile`** (type check) after every code change — no test framework exists
- **Never change the fire-and-forget LLM messaging pattern** — background returns `{ started: true }`, results arrive via separate messages
- **Never remove the service worker keepalive** (`setInterval` with `KEEPALIVE_INTERVAL_MS`)
- **Never bypass the JSON repair logic** (`repairUnescapedQuotes()` in summarizer.ts)
- **Never manually edit `tasks.json` or `.taskmaster/config.json`** — use `task-master` CLI or MCP tools
- **Never commit code unless explicitly asked**
- **Follow the Development Workflow (Phases 1-4)** in `CLAUDE.md` for all code changes
