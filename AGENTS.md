# Agent entry (agent-spec)

**Source of truth for** agent cold-start in this repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

Executable specs for coding-agent behavior. Monorepo packages: `@post-print/agent-harness` and `@post-print/agent-test`.

## Prerequisites

- Bun `1.2.x` (see `packageManager` in `package.json`)
- Node ≥ 22 for published packages and `agent-test` CLI consumers
- Live runs require `CURSOR_API_KEY` (see packages/test README)

## First hour

```bash
bun install
bun run build
bun run test
bun run audit:self
```

## Validation split

| Change type                                                  | Run                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Docs / registry / `.skeleton/`                               | `bun run validate:changed -- <path>` or `bun run audit:self`                                                              |
| Synced toolbox skills (`.agents/skills/`, `.claude/skills/`) | skipped — lint in [csark0812/toolbox](https://github.com/csark0812/toolbox); override via `.skeleton/customize/<slug>.md` |
| TypeScript under `packages/`                                 | `bun run test` + `bun run typecheck` + `bun run build`                                                                    |

## Layout

- `packages/harness` — host-agnostic agent runtime
- `packages/test` — scenario runner + `agent-test` CLI
- `.agents/skills/` — project skills (Cursor/Codex); `.claude/skills/` mirrors for Claude Code
- Team skills from [csark0812/toolbox](https://github.com/csark0812/toolbox); lockfile: `skills-lock.json`
