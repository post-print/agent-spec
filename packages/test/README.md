# @post-print/agent-test

<!-- source-of-truth: the direct-agent test package -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

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
    prompt: "Review the current change.",
    rubric: { mustReadPath: ["AGENTS.md"] },
  },
});
```

The default host is Cursor. Set `scenario.host`, `defaults.host`, or the top-level `host` option to `claude` or `openai`. The scenario host wins over the top-level override, which wins over suite defaults. The default suite name is `direct`. Sealed-workspace isolation, judging, timeout enforcement, and announce-stop retry are enabled by default.

## JSON suites and CLI

JSON is an authoring adapter, not a stored answer. This repository keeps host-agent suites under `agent-suites/<suite>/scenarios.json`.

```bash
npx agent-test --check --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --host cursor --suite smoke
```

First run: [docs/getting-started.md](../../docs/getting-started.md). Flags: [docs/cli.md](../../docs/cli.md). Suite fields, rubric, compare, and MCP: [docs/suites.md](../../docs/suites.md). Auth and adapters: [docs/hosts.md](../../docs/hosts.md). Sealed workspace and debug: [docs/isolation.md](../../docs/isolation.md).

`--doctor`, `--validate-only`, `--validate-paths`, and `--validate-seeds` are aliases for `--check`.

## In-repo package checks

Default CI does not launch a paid agent:

```bash
bun run build
node packages/test/dist/cli.js --check --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --check --suites-dir agent-suites --suite smoke
```

Host-agent acceptance is `bun run test`. That command runs smoke, tools, mcp, judge, and depth on Cursor, Claude, and Codex. `bun run test:smoke`, `bun run test:tools`, `bun run test:mcp`, `bun run test:judge`, and `bun run test:depth` stay on Cursor. A key-gated GitHub Actions job runs the same suites on Cursor when `CURSOR_API_KEY` is present.
