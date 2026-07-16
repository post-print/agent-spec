# Agent entry (agent-spec)

**Source of truth for** agent cold-start in this repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-16 -->

Executable specs for coding-agent behavior. Monorepo packages: `@post-print/agent-harness` and `@post-print/agent-test`.

## Prerequisites

- Bun `1.2.x` (see `packageManager` in `package.json`)
- Node ≥ 22 (see `engines` / `.node-version`) for published packages and `agent-test` CLI consumers
- Live runs require `CURSOR_API_KEY` (see `.env.example` and packages/test README)

## First hour

```bash
bun install
bun run build
bun run check
bun run audit:self
```

`bun run check` = lint + typecheck + test + build. `bun run test` needs unrestricted Cursor sandbox permissions (fixtures run `git init`). `bun install` may warn that `simple-git-hooks` cannot write `.git/hooks` under a sandbox; that is safe to ignore or re-run with `all` permissions.

## Validation split

| Change type                                                  | Run                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Docs / registry / `.skeleton/`                               | `bun run validate:changed -- <path>` or `bun run audit:self`                                                              |
| Synced toolbox skills (`.agents/skills/`, `.claude/skills/`) | skipped — lint in [csark0812/toolbox](https://github.com/csark0812/toolbox); override via `.skeleton/customize/<slug>.md` |
| TypeScript under `packages/`                                 | `bun run check` (or `bun run dev` without build)                                                                          |

## Layout

- `packages/harness` — host-agnostic agent runtime
- `packages/test` — scenario runner + `agent-test` CLI
- `.agents/skills/` — project skills (Cursor/Codex); `.claude/skills/` mirrors for Claude Code
- Team skills from [csark0812/toolbox](https://github.com/csark0812/toolbox); lockfile: `skills-lock.json`
