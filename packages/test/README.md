# @post-print/agent-test

<!-- source-of-truth: the direct-agent test package -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-15 -->

<!-- review-deps: paths=packages/test/src/*.ts,packages/test/src/**/*.ts,packages/test/package.json -->

Scenario runner for real Cursor, Claude, and OpenAI Codex agents, built on `@post-print/agent-harness`.

> **Deprecated and removed:** stored-trace replay is not an agent test. `host: "replay"`, `replayTrace`, `--record-fixtures`, and the old `--live` mode flag are rejected with migration guidance.

## Direct TypeScript API

`runAgentTest` is the execution core. JSON suites load into this same function.

```ts
import { runAgentTest } from "@post-print/agent-test";

const result = await runAgentTest({
  cwd: process.cwd(),
  scenario: {
    name: "uses the project instructions",
    description: "Checks that the agent reads AGENTS.md.",
    contextMode: "host-native",
    prompt: "Review the current change.",
    rubric: { reviewDepth: "standard" },
  },
});
```

The default host is Cursor. Set `contextMode: "host-native"` to send the scenario prompt unchanged and let the host discover its supported workspace context. The compatibility default, `harness-preamble`, composes configured sources and synthetic skill catalogs into the submitted input. Set `scenario.host`, `defaults.host`, or the top-level `host` option to `claude` or `openai`. The scenario host wins over the top-level override, which wins over suite defaults. The default suite name is `direct`. Sealed-workspace isolation, judging, timeout enforcement, and announce-stop retry are enabled by default.

OpenAI scenarios can set `networkAccess: true` when the task must reach a package registry or another network service. It is scenario-only and defaults to `false`. The opt-in does not disable the sealed workspace, temporary user home, or leak checks, and it does not apply to the read-only judge.

The viewer and HTML report put a **Starting context** summary beside each task. It names supplied files, servers, tools, and skills, while the recorded conversation shows the submitted task prompt. In host-native mode, the summary states that the host discovers workspace files and instructions; agent-test does not claim which host-owned context was loaded.

## JSON suites and CLI

JSON is an authoring adapter, not a stored answer. This repository keeps host-agent suites under `agent-suites/<suite>/scenarios.json`.

```bash
npx agent-test login
npx agent-test --check --suites-dir agent-suites
npx agent-test viewer --suites-dir agent-suites --workers 2
npx agent-test --suites-dir agent-suites --host cursor --suite test-sdk-capabilities
npx agent-test --suites-dir agent-suites --host cursor --auth-mode api-key
```

First run: [docs/getting-started.md](../../docs/getting-started.md). Flags: [docs/cli.md](../../docs/cli.md). Suite fields, rubric, compare, and MCP: [docs/suites.md](../../docs/suites.md). Auth and adapters: [docs/hosts.md](../../docs/hosts.md). Sealed workspace and debug: [docs/isolation.md](../../docs/isolation.md).

`--doctor`, `--validate-only`, `--validate-paths`, and `--validate-seeds` are aliases for `--check`.

## In-repo package checks

Default CI does not launch a host agent:

```bash
bun run build
node packages/test/dist/cli.js --check --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --check --suites-dir agent-suites
```

`bun run test` is offline and sandbox-safe. Provider-backed runs are manual: `bun run test:capabilities` exercises supported `runAgentTest` capabilities on Cursor, and the tour has its own command. The host matrix and 20-run qualification are also manual. CI does not launch a provider-backed host.

`bun run test:sdk:consumer` packs both packages, installs them in a clean Node 22 fixture, compiles the public declarations, runs a fake adapter, inspects comparison results, and runs the installed CLI. It does not use host credentials.

## Viewer e2e

Playwright drives the suite viewer and the HTML report preview. The viewer shows run totals at the top. Each compare arm has a tab that swaps the visible chat.

```bash
bunx playwright install chromium
bun run test:e2e
```

The suite uses a fake runner. It does not launch a host agent.
