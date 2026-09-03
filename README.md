# agent-spec

**Source of truth for** package overview.

<!-- doc-meta: owner=eng | last-reviewed=2026-09-02 -->

Executable specs for coding-agent behavior.

## Packages

| Package                                         | Purpose                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@post-print/agent-harness`](packages/harness) | Host-agnostic agent runtime: context load, Cursor/Claude adapters, capture, judge |
| [`@post-print/agent-test`](packages/test)       | Direct-agent scenario runner + `agent-test` CLI                                  |

Consumer repos can call the typed `runAgentTest` API directly or keep JSON suites locally (for example `agent-suites/<suite>/scenarios.json`). JSON is an authoring adapter: every test execution launches Cursor or Claude.

> **Deprecated and removed:** replay-based tests and committed replay traces are no longer supported. `host: "replay"`, `replayTrace`, `--record-fixtures`, and the old `--live` mode flag fail with migration guidance.

## Consumer usage (Node >= 22)

Published packages are native ESM and run under Node (no Bun required at runtime):

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --host claude
```

## Develop

Local builds still use Bun. Copy `.env.example` when you need live/dogfood env vars (**export** them; the CLI does not auto-load `.env`):

```bash
bun install
bun run build
bun run test:sandbox-safe
```

Full gate: `bun run check` (needs unrestricted Cursor sandbox / `all` — some tests run `git init`). Or `bun run dev` for lint + typecheck + all tests. In-repo CLI smoke (after build):

```bash
node packages/test/dist/cli.js --validate-only --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --doctor
node packages/test/dist/cli.js --validate-only --validate-paths --suites-dir agent-suites
node packages/test/dist/cli.js --validate-seeds --suites-dir agent-suites
```

Reliability targets and failure categories: [docs/reliability.md](docs/reliability.md).

Scoped checks: `bunx vitest run <file>` and `bunx biome check <path>` (use `bunx biome`, not a global `biome`).

## Debug / troubleshoot

- Prefer `bun run test:sandbox-safe` under the default Cursor sandbox (skips git-init and `.cursor` tmp fixtures). Full `bun run test` / `bun run check` need unrestricted (`all`) permissions.
- `bun install` may warn that `simple-git-hooks` cannot write `.git/hooks` under a sandbox; install still succeeds.
- Direct runs need `CURSOR_API_KEY` **exported** for Cursor or `ANTHROPIC_API_KEY` for Claude (see `.env.example`; CLI does not load `.env`). They can incur provider usage. Missing suites directory (default `agent-suites/`) is an error.
- Prefer CI publish (provenance) over manual `npm publish`; see Publish below.

## Publish

Merging to `main` (or `workflow_dispatch` on `.github/workflows/publish.yml`) publishes a patch by default with npm provenance. Manual publish (no provenance / no version bump automation):

```bash
bun run build
cd packages/harness && npm publish --access public
cd ../test && npm publish --access public
```
