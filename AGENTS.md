# Agent entry (agent-spec)

<!-- source-of-truth: agent cold-start in this repo -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-26 -->

<!-- review-deps: paths=package.json,biome.json,skeleton.toml,.github/workflows/test.yml -->

Executable specs for coding-agent behavior. Monorepo packages: `@post-print/agent-harness` and `@post-print/agent-test`.

## Doc routing

Use the bounded Skeleton context workflow below before reading repository files directly. The table remains the human topic map.

| Branch | Paper |
| --- | --- |
| TypeScript API, configured agents, judges, comparisons | [docs/sdk-v2.md](docs/sdk-v2.md) |
| Getting started (install, first suite, first live run) | [docs/getting-started.md](docs/getting-started.md) |
| CLI commands, discovery, viewer | [docs/cli.md](docs/cli.md) |
| TypeScript suites, comparisons, MCP | [docs/suites.md](docs/suites.md) |
| Hosts, auth, custom adapters | [docs/hosts.md](docs/hosts.md) |
| Isolation, sealed workspace, debug | [docs/isolation.md](docs/isolation.md) |
| Offline validation and live reliability | [docs/reliability.md](docs/reliability.md) |

## Prerequisites

- Bun `1.4.0` (see `packageManager` in `package.json`)
- Node ≥ 22 (see `engines` / `.node-version`) for published packages and `agent-test` CLI consumers
- Host-agent runs need host auth. Agent definitions default to subscription. Use `agent-test login` for Cursor SDK auth, `codex login` for OpenAI, or Claude Code login. Explicit API-key auth is `{ type: "api-key", env: "OPENAI_API_KEY" }` on the definition. The CLI does not load `.env`.
- TypeScript suites return named `agent()` and `judge({ prompt, schema })` resources from `describe`; tests receive executable handles. `judge.run({ input })` sees only selected data and reviewer context. Assertions determine acceptance.
- `bun run test`, `bun run test:unit`, and `bun run test:sandbox-safe` do not launch a host agent. Provider-backed capability, tour, matrix, and reliability runs are manual.

## First hour

```bash
bun install
bun run build
bun run test:sandbox-safe
bun run audit:self
node packages/test/dist/cli.js test --list
node packages/test/dist/cli.js viewer
```

The full local check (`bun run check` = lint + typecheck + unit tests + build) needs unrestricted Cursor sandbox permissions (`all`) because some fixtures run `git init` or write `.cursor/` trees under tmp. Prefer `bun run test:sandbox-safe` under the default sandbox (skips those fixtures). Do not treat sandbox `git`/`hooks`/`.cursor` failures as a broken repo.

`bun install` can warn that `simple-git-hooks` cannot write `.git/hooks` under a sandbox. That is safe to ignore or re-run with `all` permissions.

Use `bun run lint` / `bunx biome` (pinned 2.5.12). The policy matches PostPrint applications: all project/types/react/test domains, 40-line functions, cognitive complexity 10, at most three parameters, and no explicit `any` even in tests. Non-null assertions are also errors; the lint script fails on warnings. Root configuration, scripts, and the TypeScript tour are included. Existing legacy violations are not suppressed. A global `biome` on PATH is often older and will fail this repo's config.

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
| Host-agent suite | `bun run test:capabilities` for configured-agent SDK capabilities. Run `test:matrix` and `test:reliability` manually. |

`validate:changed` fails a live coverage-candidate path with no owning paper (`uncovered-changed-path`). Hash review proof lives in `.skeleton/review-lock.json`. After a complete re-read, attest explicit paths only:

```bash
skeleton audit docs --paths=docs/reliability.md --fix=doc-meta --confirm-reviewed
```

## Layout

- `packages/harness` — host-agnostic agent runtime (Cursor, Claude, OpenAI Codex)
- `packages/test` — Playwright-backed named resources, independent tasks, structured judges, viewer, and CLI. Public exports are in `src/sdk/`; JSON execution has been removed.
- `agent-suites/tour/` — TypeScript examples with reusable agent and judge definitions; configured by `agent-test.config.ts`; the cross-host matrix uses `agent-test.matrix.config.ts`.
- `agent-suites/test-sdk-capabilities/` — eleven TypeScript capability tests using the same SDK as the tour.
- `skeleton.toml` — Skeleton scan perimeter, review proof, and coverage
- `.agents/skills/` — project skills (Cursor/Codex); `.claude/skills/` mirrors for Claude Code
- Team skills from [csark0812/toolbox](https://github.com/csark0812/toolbox); lockfile: `skills-lock.json`

<!-- skeleton: context-guide -->
## Skeleton context

Make `npx --no-install skeleton context "<topic>"` the first repository command. Use `--path` only for a known implementation path and `--staged` for staged-code questions. Never combine a topic with `--path`. Returned document, source, and test excerpts are already read; do not read those files again. Do not rerun context or search, list, or read returned paths when the packet contains a document, source, and test; edit directly from that packet. Complete every `action` line and verify it against the final files. Preserve existing work. For read-only work, answer immediately when the returned evidence fully answers a read-only request. Do not run repository-wide searches, file listings, or status checks to reconfirm a complete result. For changes: If a test is returned, make the edits and run only the returned `test-command` once without progress narration between the edits and test. Stop when it passes. Inspect again only when that test fails, and inspect only the failure-specific region. Otherwise use one combined command to find and read the focused test. Do not run Skeleton audits, validation, or review-proof commands unless the user requested them or the focused test fails.

When context returns `no-context`, inspect code, tests, and nearby docs to find the canonical owner. Repair an existing owner's summary, content, or `review-deps`; create an owner only for durable features, policies, workflows, or architectural contracts. Include a `source-of-truth` summary and appropriate `review-deps`; a `--path` miss needs an owning document. For read-only tasks, report the gap and proposed follow-up without editing. Skip one-off debugging details and transient implementation facts. Rerun the exact context request until it returns the owner.
