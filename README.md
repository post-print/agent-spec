# agent-spec

**Source of truth for** package overview.

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

Executable specs for coding-agent behavior.

## Packages

| Package | Purpose |
| --- | --- |
| [`@post-print/agent-harness`](packages/harness) | Host-agnostic agent runtime: context load, Cursor/Claude/OpenAI adapters, capture, judge |
| [`@post-print/agent-test`](packages/test) | Direct-agent scenario runner + `agent-test` CLI |

Consumer repos can call the typed `runAgentTest` API or keep JSON suites locally (`agent-suites/<suite>/scenarios.json`). JSON is an authoring adapter. A live CLI run launches Cursor, Claude, or OpenAI Codex.

> **Deprecated and removed:** replay-based tests and committed replay traces are no longer supported. `host: "replay"`, `replayTrace`, `--record-fixtures`, and the old `--live` mode flag fail with migration guidance.

## Consumer usage (Node >= 22)

Published packages are native ESM and run under Node (no Bun required at runtime):

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --host claude
npx agent-test --suites-dir agent-suites --host openai
```

## Develop

Local builds still use Bun. Copy `.env.example` when you need live env vars (**export** them; the CLI does not auto-load `.env`):

```bash
bun install
bun run build
bun run test:sandbox-safe
```

`bun run test:unit` does not launch a paid agent. Full unpaid gate: `bun run check` (needs unrestricted Cursor sandbox / `all` because some tests run `git init`). In-repo CLI checks after build:

```bash
node packages/test/dist/cli.js --check --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --check --suites-dir agent-suites --suite smoke
```

Host-agent suite (exported host key; incurs provider usage):

```bash
bun run test
```

Reliability targets: [docs/reliability.md](docs/reliability.md).

Scoped checks: `bun test <file>` and `bunx biome check <path>` (use `bunx biome`, not a global `biome`).

## Debug / troubleshoot

- Prefer `bun run test:sandbox-safe` under the default Cursor sandbox (skips git-init and `.cursor` tmp fixtures). Full `bun run test:unit` / `bun run check` need unrestricted (`all`) permissions.
- `bun install` can warn that `simple-git-hooks` cannot write `.git/hooks` under a sandbox. Install still succeeds.
- Direct runs need an exported host key. See `.env.example`. The CLI does not load `.env`.
- Prefer CI publish (provenance) over manual `npm publish`. See Publish below.

## Publish

Merging to `main` (or `workflow_dispatch` on `.github/workflows/publish.yml`) publishes a patch by default with npm provenance. Manual publish (no provenance / no version bump automation):

```bash
bun run build
cd packages/harness && npm publish --access public
cd ../test && npm publish --access public
```
