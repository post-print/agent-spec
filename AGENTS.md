# Agent entry (agent-spec)

<!-- source-of-truth: agent cold-start in this repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-15 -->

<!-- review-deps: paths=package.json,skeleton.toml,.github/workflows/test.yml -->

Executable specs for coding-agent behavior. Monorepo packages: `@post-print/agent-harness` and `@post-print/agent-test`.

## Doc routing

1. Local `audit` / `validate` writes `.skeleton/catalog.md` (skipped when `CI=true`).
2. Skim the catalog summaries.
3. For a hit, read only the source-of-truth line / first ~20 lines of that file.
4. Open the full doc only if it is truly relevant.

| Branch | Paper |
| --- | --- |
| Getting started (install, first suite, first live run) | [docs/getting-started.md](docs/getting-started.md) |
| CLI flags, viewer, check versus live | [docs/cli.md](docs/cli.md) |
| Suites, rubric, compare, MCP | [docs/suites.md](docs/suites.md) |
| Hosts, auth, custom adapters | [docs/hosts.md](docs/hosts.md) |
| Isolation, sealed workspace, debug | [docs/isolation.md](docs/isolation.md) |
| Reliability targets and fail-on | [docs/reliability.md](docs/reliability.md) |

## Prerequisites

- Bun `1.4.0` (see `packageManager` in `package.json`)
- Node ≥ 22 (see `engines` / `.node-version`) for published packages and `agent-test` CLI consumers
- Host-agent runs need host auth. Default is subscription after CLI login: `npx agent-test login` (Cursor SDK store), Claude Code login, or `codex login`. The Cursor app login does not count. Pass `--auth-mode api-key` (alias `--auth-method`) plus `CURSOR_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` / `CODEX_API_KEY` to bill an API key. Per-host `*_AUTH_MODE` env vars still work when the flag is omitted. Copy `.env.example`. The CLI does not auto-load `.env`.
- The judge and the default user simulator use the same host family as the test agent. The judge runs when a rubric has judge questions or `mustInvokeSkill`. `--no-judge` turns the judge off.
- `bun run test`, `bun run test:unit`, and `bun run test:sandbox-safe` do not launch a host agent. Provider-backed capability, tour, matrix, and reliability runs are manual.

## First hour

```bash
bun install
bun run build
bun run test:sandbox-safe
bun run audit:self
node packages/test/dist/cli.js --check --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --check --suites-dir agent-suites
node packages/test/dist/cli.js viewer --suites-dir agent-suites
```

The full local check (`bun run check` = lint + typecheck + unit tests + build) needs unrestricted Cursor sandbox permissions (`all`) because some fixtures run `git init` or write `.cursor/` trees under tmp. Prefer `bun run test:sandbox-safe` under the default sandbox (skips those fixtures). Do not treat sandbox `git`/`hooks`/`.cursor` failures as a broken repo.

`bun install` can warn that `simple-git-hooks` cannot write `.git/hooks` under a sandbox. That is safe to ignore or re-run with `all` permissions.

Use `bun run lint` / `bunx biome` (pinned 2.5.12). A global `biome` on PATH is often older and will fail this repo's config.

Offline product tests:

```bash
bun run test
```

Manual host-agent proof after host login uses `bun run test:capabilities` or `bun run test:tour`. `bun run test:matrix` and `bun run test:reliability` are also manual. `bun run test:sdk:consumer` needs no host credentials. CI does not launch a provider-backed host.

## Validation split

| Change type | Run |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Docs / `skeleton.toml` / `.skeleton/` | `bun run validate:changed -- <path>` or `bun run audit:self` |
| Synced toolbox skills (`.agents/skills/`, `.claude/skills/`) | skipped — lint in [csark0812/toolbox](https://github.com/csark0812/toolbox) or the owning skill repo |
| TypeScript under `packages/` (scoped) | `bun test <file>` and `bunx biome check <path>`; then `bunx tsc --build` if types changed |
| TypeScript under `packages/` (full) | `bun run test:sandbox-safe` (or `bun run check` with `all` permissions) |
| Viewer e2e (Playwright) | `bunx playwright install chromium` then `bun run test:e2e` |
| Host-agent suite | `bun run test:capabilities` for supported `runAgentTest` capabilities. Run `test:matrix` and `test:reliability` manually. |

`validate:changed` fails a live coverage-candidate path with no owning paper (`uncovered-changed-path`). Hash review proof lives in `.skeleton/review-lock.json`. After a complete re-read, attest explicit paths only:

```bash
skeleton audit docs --paths=docs/reliability.md --fix=doc-meta --confirm-reviewed
```

## Layout

- `packages/harness` — host-agnostic agent runtime (Cursor, Claude, OpenAI Codex)
- `packages/test` — direct-agent scenario runner + `agent-test` CLI; JSON suites are an input adapter
- `agent-suites/` — in-repo host-agent suites. Each scenario uses a dedicated workspace. A `compare` scenario runs two or more arms. Optional metric rules name winner-versus-loser pairs. An arm can add extra rubric checks. A shared judge runs only when `rubric.judge` is set. Host-global user skills stay out unless `allowUserSkills` is true. Default CLI `--suites-dir`
- `skeleton.toml` — Skeleton scan perimeter, review proof, and coverage
- `.agents/skills/` — project skills (Cursor/Codex); `.claude/skills/` mirrors for Claude Code
- Team skills from [csark0812/toolbox](https://github.com/csark0812/toolbox); lockfile: `skills-lock.json`
