# @post-print/agent-test

**Source of truth for** the direct-agent test package.

<!-- doc-meta: owner=eng | last-reviewed=2026-09-02 -->

Scenario runner for real Cursor and Claude agents, built on `@post-print/agent-harness`.

> **Deprecated and removed:** stored-trace replay is not an agent test. `host: "replay"`, `replayTrace`, `--record-fixtures`, and the old `--live` mode flag are rejected with migration guidance. Every scenario execution now launches Cursor or Claude and can incur provider usage.

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

The default host is Cursor. Set `scenario.host: "claude"`, `defaults.host`, or the top-level `host` option for Claude. The scenario host wins over the top-level override, which wins over suite defaults. The default suite name is `direct`; worktree isolation, judging, timeout enforcement, and announce-stop retry are enabled by default.

## JSON suites and CLI

JSON is an authoring adapter, not a stored answer. Consumer repositories can keep suites under `agent-suites/<suite>/scenarios.json`:

```json
{
  "name": "routing",
  "defaults": { "host": "cursor", "profile": "cursor" },
  "scenarios": [
    {
      "name": "reads instructions",
      "prompt": "Review the current change.",
      "rubric": { "mustReadPath": ["AGENTS.md"] }
    }
  ]
}
```

Run Cursor by default or select Claude explicitly:

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --suite routing
npx agent-test --suites-dir agent-suites --host claude
npx agent-test --doctor
```

Direct runs require an exported `CURSOR_API_KEY` for Cursor or `ANTHROPIC_API_KEY` plus the Claude Code CLI for Claude. Judge criteria use `CURSOR_API_KEY` unless `--no-judge` is set. The CLI does not load `.env`.

The old `--live` flag is removed because direct execution is now the only execution mode. Direct runs capture transient traces automatically; use `--keep-recordings` or `--debug` to retain diagnostics.

## Validation, rubrics, and comparison

These commands inspect configuration or existing reports; they do not claim to execute an agent:

```bash
npx agent-test --validate-only --validate-paths --suites-dir agent-suites
npx agent-test --validate-seeds --suites-dir agent-suites
npx agent-test --compare-pairs clean:changed --out-dir "$TMPDIR/compare"
npx agent-test compare --a clean.suite-report.json --b changed.suite-report.json --out-dir "$TMPDIR/compare"
```

`scenarios.json` may omit inline rubric keys when they are supplied by sibling `rubrics.json` / `scenarios.rubric.json`, or by `--rubrics-dir <path>` at `<path>/<suite>/rubrics.json`. External rubric entries replace the inline rubric for the same scenario.

Reports pair scenarios by `compareId` when present, otherwise by normalized scenario name. JSON, Markdown, and HTML reports include outcomes, token usage, duration, tools, and grounding signals.

## Isolation and diagnostics

Each scenario uses a detached git worktree by default. This isolates edits, but it does not prevent a local host from reading the IDE-open caller checkout. Keep answer keys outside agent-visible roots when that distinction matters.

`--debug` retains an evidence bundle under `$TMPDIR/agent-spec/sessions/<id>/` by default. It includes the transcript, scenario, result, trace, failures, environment metadata, judge details, and an exact direct-run rerun command. Use `--debug-dir` to override the parent directory.

`Ctrl+C` cancels active Cursor/Claude work and cleans worktrees. `--no-worktree` requires `AGENT_TEST_ALLOW_IN_PLACE=1` because agent edits will persist in the caller checkout.

Dialogue-first skills must be tested with a one-shot prompt or an intentional `--allow-user-input` run. Do not weaken the production skill to make a headless test pass.

## MCP servers

Cursor and Claude scenarios can attach inline stdio or HTTP/SSE MCP servers through suite defaults or scenario overrides. Scenario server names replace matching defaults. `${ENV_VAR}` placeholders resolve at run time. Ambient project/user MCP configuration is not loaded.

## In-repo package checks

The repository does not run paid agents in its default CI package-integrity checks:

```bash
bun run build
node packages/test/dist/cli.js --validate-only --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --doctor
```

Credentialed acceptance requires one TypeScript `runAgentTest` call and one JSON-suite CLI run against a real host.
