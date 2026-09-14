# agent-spec

<!-- source-of-truth: package overview -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

<!-- review-deps: paths=package.json,packages/*/package.json -->

Executable specs for coding-agent behavior.

## Packages

| Package | Purpose |
| --- | --- |
| [`@post-print/agent-harness`](packages/harness) | Host-agnostic agent runtime: context load, Cursor/Claude/OpenAI adapters, capture, judge |
| [`@post-print/agent-test`](packages/test) | Direct-agent scenario runner + `agent-test` CLI |

Consumer repos can call the typed `runAgentTest` API or keep JSON suites locally (`agent-suites/<suite>/scenarios.json`). JSON is an authoring adapter. A live CLI run launches Cursor, Claude, or OpenAI Codex.

## Docs

First consumer hour: [docs/getting-started.md](docs/getting-started.md). Topic index: [.skeleton/registry.md](.skeleton/registry.md).

| Paper | Use when |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, write one suite, check, launch |
| [CLI](docs/cli.md) | Flags, check versus live, in-repo scripts |
| [Suites](docs/suites.md) | JSON fields, rubric, compare, MCP |
| [Hosts](docs/hosts.md) | Auth and custom adapters |
| [Isolation](docs/isolation.md) | Sealed workspace, skills, debug bundles |
| [Reliability](docs/reliability.md) | Targets, fail-on, environment knobs |

> **Deprecated and removed:** replay-based tests and committed replay traces are no longer supported. `host: "replay"`, `replayTrace`, `--record-fixtures`, and the old `--live` mode flag fail with migration guidance.

## Consumer usage (Node >= 22)

Published packages are native ESM and run under Node (no Bun required at runtime):

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --host cursor
npx agent-test --suites-dir agent-suites --adapter ./hosts/gemini.mjs --host gemini
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
node packages/test/dist/cli.js --check --suites-dir agent-suites
```

Host-agent suite (host key or CLI/SDK login; incurs provider usage):

```bash
bun run test
```

`bun run test` runs smoke, tools, mcp, judge, and depth on Cursor, Claude, and Codex. Pin one host with `bun run test -- --host cursor`. `bun run test:smoke` is the short Cursor proof.

Reliability targets: [docs/reliability.md](docs/reliability.md).

Scoped checks: `bun test <file>` and `bunx biome check <path>` (use `bunx biome`, not a global `biome`).

## Debug / troubleshoot

- Prefer `bun run test:sandbox-safe` under the default Cursor sandbox (skips git-init and `.cursor` tmp fixtures). Full `bun run test:unit` / `bun run check` need unrestricted (`all`) permissions.
- `bun install` can warn that `simple-git-hooks` cannot write `.git/hooks` under a sandbox. Install still succeeds.
- Direct runs need host auth. A key or a login mode works. See `.env.example`. The CLI does not load `.env`.
- Prefer CI publish (provenance) over manual `npm publish`. See Publish below.

## Publish

Merging to `main` (or `workflow_dispatch` on `.github/workflows/publish.yml`) publishes a patch by default with npm provenance. Manual publish (no provenance / no version bump automation):

```bash
bun run build
cd packages/harness && npm publish --access public
cd ../test && npm publish --access public
```
