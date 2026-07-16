# agent-spec

**Source of truth for** package overview.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-16 -->

Executable specs for coding-agent behavior.

## Packages

| Package                                         | Purpose                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@post-print/agent-harness`](packages/harness) | Host-agnostic agent runtime: context load, replay, Cursor adapter, capture, judge |
| [`@post-print/agent-test`](packages/test)       | Scenario runner + `agent-test` CLI                                                |

Consumer repos keep suites locally (for example `agent-suites/<suite>/scenarios.json`) and depend on these packages from npm.

## Consumer usage (Node >= 22)

Published packages are native ESM and run under Node (no Bun required at runtime):

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --live   # CURSOR_API_KEY required
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
node packages/test/dist/cli.js --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --doctor
```

Scoped checks: `bunx vitest run <file>` and `bunx biome check <path>` (use `bunx biome`, not a global `biome`).

## Debug / troubleshoot

- Prefer `bun run test:sandbox-safe` under the default Cursor sandbox (skips git-init and `.cursor` tmp fixtures). Full `bun run test` / `bun run check` need unrestricted (`all`) permissions.
- `bun install` may warn that `simple-git-hooks` cannot write `.git/hooks` under a sandbox; install still succeeds.
- Live `--live` runs need `CURSOR_API_KEY` **exported** (see `.env.example`; CLI does not load `.env`). Missing suites directory (default `agent-suites/`) errors with ENOENT in this monorepo; use `packages/test/fixtures` for local smoke.
- Prefer CI publish (provenance) over manual `npm publish`; see Publish below.

## Publish

Merging to `main` (or `workflow_dispatch` on `.github/workflows/publish.yml`) publishes a patch by default with npm provenance. Manual publish (no provenance / no version bump automation):

```bash
bun run build
cd packages/harness && npm publish --access public
cd ../test && npm publish --access public
```
