# Agent entry (agent-spec)

**Source of truth for** agent cold-start in this repo.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-16 -->

Executable specs for coding-agent behavior. Monorepo packages: `@post-print/agent-harness` and `@post-print/agent-test`.

## Prerequisites

- Bun `1.2.x` (see `packageManager` in `package.json`)
- Node ≥ 22 (see `engines` / `.node-version`) for published packages and `agent-test` CLI consumers
- Live `--live` runs require an **exported** `CURSOR_API_KEY` for Cursor (default) or `ANTHROPIC_API_KEY` for `--host claude` (copy `.env.example`; the CLI does not auto-load `.env`). Judge classifiers still need `CURSOR_API_KEY` unless `--no-judge`.

## First hour

```bash
bun install
bun run build
bun run test:sandbox-safe   # default Cursor sandbox OK
bun run audit:self
node packages/test/dist/cli.js --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --doctor
```

Full gate (`bun run check` = lint + typecheck + **all** tests + build) needs unrestricted Cursor sandbox permissions (`all`) because some fixtures run `git init` or write `.cursor/` trees under tmp. Prefer `bun run test:sandbox-safe` under the default sandbox (skips those fixtures); do not treat sandbox `git`/`hooks`/`.cursor` failures as a broken repo.

`bun install` may warn that `simple-git-hooks` cannot write `.git/hooks` under a sandbox; that is safe to ignore or re-run with `all` permissions.

Use `bun run lint` / `bunx biome` (pinned 2.5.4). A global `biome` on PATH is often older and will fail this repo's config.

## Validation split

| Change type                                                  | Run                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Docs / registry / `.skeleton/`                               | `bun run validate:changed -- <path>` or `bun run audit:self`                                                              |
| Synced toolbox skills (`.agents/skills/`, `.claude/skills/`) | skipped — lint in [csark0812/toolbox](https://github.com/csark0812/toolbox); override via `.skeleton/customize/<slug>.md` |
| TypeScript under `packages/` (scoped)                        | `bunx vitest run <file>` and `bunx biome check <path>`; then `bunx tsc --build` if types changed                          |
| TypeScript under `packages/` (full)                          | `bun run test:sandbox-safe` (or `bun run check` with `all` permissions)                                                   |

## Layout

- `packages/harness` — host-agnostic agent runtime
- `packages/test` — scenario runner + `agent-test` CLI
- `.agents/skills/` — project skills (Cursor/Codex); `.claude/skills/` mirrors for Claude Code
- Team skills from [csark0812/toolbox](https://github.com/csark0812/toolbox); lockfile: `skills-lock.json`
