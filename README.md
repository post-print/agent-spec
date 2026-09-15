# agent-spec

<!-- source-of-truth: package overview -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-15 -->

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

## Example suites

The repository includes two runnable suites. They are designed as a short
learning path, not as hidden fixtures:

| Suite | What it shows | Command |
| --- | --- | --- |
| `test-sdk-capabilities` | Eleven manual live checks for supported `runAgentTest` capabilities | `bun run test:capabilities` |
| `tour` | A product tour, including MCP workflows and a tool experiment | `bun run test:tour` |

Start with [Getting started](docs/getting-started.md), then read the
[suite authoring guide](docs/suites.md). Every live scenario starts in a new
sealed workspace. A compare scenario keeps each arm visible and reports one
experiment outcome; an expected failed control arm does not make the
experiment fail when its declared gates pass.

Set `contextMode: "host-native"` to send the scenario prompt unchanged and let each host discover its supported project context. The default `harness-preamble` mode preserves 1.0 behavior. Reports and the live viewer show the exact initial user input submitted to built-in adapters, with any preamble files broken out visually.

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

`bun run test:unit` does not launch a host agent. Full local check: `bun run check` (needs unrestricted Cursor sandbox / `all` because some tests run `git init`). In-repo CLI checks after build:

```bash
node packages/test/dist/cli.js --check --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --check --suites-dir agent-suites
```

Offline product tests:

```bash
bun run test
```

Manual live suites require host auth and incur provider usage. `bun run test:capabilities` runs the supported `runAgentTest` capability checks on Cursor. `bun run test:tour` runs the product tour. `bun run test:matrix` checks the capabilities on all built-in hosts. `bun run test:reliability` repeats the capability suite for qualification.

The installed-package contract needs no host credentials:

```bash
bun run test:sdk:consumer
```

Reliability targets: [docs/reliability.md](docs/reliability.md).

Scoped checks: `bun test <file>` and `bunx biome check <path>` (use `bunx biome`, not a global `biome`).

Viewer e2e uses Playwright. Install Chromium once, then run the suite:

```bash
bunx playwright install chromium
bun run test:e2e
```

The e2e suite uses a fake runner. It does not launch a host agent.

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
