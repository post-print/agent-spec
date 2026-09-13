# @post-print/agent-test

**Source of truth for** the direct-agent test package.

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

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
    prompt: "Review the current change.",
    rubric: { mustReadPath: ["AGENTS.md"] },
  },
});
```

The default host is Cursor. Set `scenario.host`, `defaults.host`, or the top-level `host` option to `claude` or `openai`. The scenario host wins over the top-level override, which wins over suite defaults. The default suite name is `direct`. Sealed-workspace isolation, judging, timeout enforcement, and announce-stop retry are enabled by default.

## JSON suites and CLI

JSON is an authoring adapter, not a stored answer. This repository keeps host-agent suites under `agent-suites/<suite>/scenarios.json`. Consumer repositories can use the same layout.

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --suite smoke
npx agent-test --suites-dir agent-suites --host claude
npx agent-test --suites-dir agent-suites --host openai
npx agent-test --doctor
```

Direct runs need an exported host key. Cursor uses `CURSOR_API_KEY`. Claude uses `CLAUDE_AUTH_MODE` plus `ANTHROPIC_API_KEY` or a Claude Code login. OpenAI uses `OPENAI_API_KEY` or `CODEX_API_KEY` plus the Codex CLI. The judge uses the same host family. It runs when a rubric has judge questions or `mustInvokeSkill`. `--no-judge` turns it off. The CLI does not load `.env`.

`--allow-user-input` starts a second classifier as the user. That user agent answers AskQuestion-style tools. The test agent then continues with the original task plus the transcript.

## Validation, rubrics, and comparison

These commands inspect configuration or existing reports. They do not launch an agent:

```bash
npx agent-test --validate-only --validate-paths --suites-dir agent-suites
npx agent-test --validate-seeds --suites-dir agent-suites
npx agent-test compare --a clean.suite-report.json --b changed.suite-report.json --out-dir "$TMPDIR/compare"
```

`scenarios.json` can omit inline rubric keys when a sibling `rubrics.json` / `scenarios.rubric.json` or `--rubrics-dir` supplies them.

## Isolation and diagnostics

Each scenario copies HEAD plus caller context into a temp folder. The folder gets its own `.git`. The runner fails the scenario when tool paths leave that folder. A leftover caller-tree check still restores leaked caller edits.

`--debug` retains an evidence bundle under `$TMPDIR/agent-spec/sessions/<id>/` by default. Use `--debug-dir` to override the parent directory.

`Ctrl+C` cancels active host work and deletes the temp folder. `--no-worktree` requires `AGENT_TEST_ALLOW_IN_PLACE=1` because agent edits will persist in the caller checkout.

## MCP servers

Scenarios can attach inline stdio or HTTP/SSE MCP servers through suite defaults or scenario overrides. Ambient project/user MCP configuration is not loaded.

## In-repo package checks

Default CI does not launch a paid agent:

```bash
bun run build
node packages/test/dist/cli.js --validate-only --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --validate-only --suites-dir agent-suites --suite smoke
node packages/test/dist/cli.js --doctor
```

Host-agent acceptance is `bun run test` (one JSON-suite CLI run against a real host). A key-gated GitHub Actions job runs the same suite when `CURSOR_API_KEY` is present.
