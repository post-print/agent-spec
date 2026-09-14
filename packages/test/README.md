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
npx agent-test --suites-dir agent-suites --host cursor
npx agent-test --suites-dir agent-suites --suite smoke
npx agent-test --suites-dir agent-suites --suite tools
npx agent-test --suites-dir agent-suites --suite mcp
npx agent-test --suites-dir agent-suites --suite judge
npx agent-test --suites-dir agent-suites --suite depth
npx agent-test --check --suites-dir agent-suites
```

In-repo suites list `hosts: ["cursor", "claude", "openai"]`. `npx agent-test --suites-dir agent-suites` and `bun run test` run every suite on each host. That is the consumer confidence gate. Pass `--host cursor` to pin one adapter.

`smoke` is the short host proof. `tools` checks Read and Write. `mcp` checks echo invoke and a lookup read. `judge` starts a second host call that scores the reply. `depth` checks workspace roots, seed patches, injected context, mustRun, and skill invoke. `bun run test:smoke` stays on Cursor.

`scenario.host` pins that scenario to one host. A matrix run skips it on the other hosts.

## Custom hosts

A consumer repo can register its own adapter.

```js
// agent-test.config.mjs
import { defineConfig } from "@post-print/agent-test";

export default defineConfig({
  adapters: [
    {
      host: "gemini",
      missingAuth() {
        return process.env.GEMINI_API_KEY ? undefined : "GEMINI_API_KEY not set";
      },
      classifierHost: "cursor",
      async run(options) {
        return {
          host: "gemini",
          status: "completed",
          durationMs: 0,
          trace: {
            messages: [{ role: "assistant", content: options.prompt }],
            toolCalls: [],
            shellCommands: [],
            artifacts: {},
          },
        };
      },
    },
  ],
});
```

Then `--host gemini` and a suite `hosts` list can include `gemini`. You can also pass `--adapter ./hosts/gemini.mjs`. The module can export `{ adapters: [...] }` or call `registerHostAdapter` as a side effect.

Do not reuse `cursor`, `claude`, `openai`, `replay`, or `all` as the slug.

Direct runs need host auth. Cursor uses `CURSOR_API_KEY`, or `CURSOR_AUTH_MODE=subscription` after `Cursor.auth.login()`. The Cursor app login does not count. Claude uses `CLAUDE_AUTH_MODE` plus `ANTHROPIC_API_KEY` or a Claude Code login. OpenAI uses `OPENAI_API_KEY` or `CODEX_API_KEY`, or `OPENAI_AUTH_MODE=subscription` after `codex login`. The judge uses the same host family. It runs when a rubric has judge questions or `mustInvokeSkill`. `--no-judge` turns it off. The CLI does not load `.env`.

`--allow-user-input` starts a second classifier as the user. That user agent answers AskQuestion-style tools. The test agent then continues with the original task plus the transcript.

## Check, rubrics, and comparison

`--check` inspects the suite, seeds, package, and host. It does not launch an agent. A live run runs the same check first, then starts the host.

```bash
npx agent-test --check --suites-dir agent-suites
npx agent-test compare --a clean.suite-report.json --b changed.suite-report.json --out-dir "$TMPDIR/compare"
```

`--doctor`, `--validate-only`, `--validate-paths`, and `--validate-seeds` are aliases for `--check`.

`scenarios.json` can omit inline rubric keys when a sibling `rubrics.json` / `scenarios.rubric.json` or `--rubrics-dir` supplies them.

## Isolation and diagnostics

In-repo suites set `workspace` on every scenario. The runner copies that folder into a temp repo. Omit `workspace`, or set `"."`, to copy HEAD plus caller context instead. The folder gets its own `.git`. The runner fails the scenario when tool paths leave that folder. A leftover caller-tree check still restores leaked caller edits.

Host-global user skills stay out of the run by default. Those trees live under `~/.cursor/skills`, `~/.claude/skills`, `~/.codex/skills`, and `~/.agents/skills`. A custom `workspace` is a fixture. Keep `allowUserSkills` false for that case. Set `allowUserSkills` to true on the scenario or suite defaults when the test needs the machine skill set. The `skills` field only overlays repo-relative folders into the sealed workspace.

`contextSources` and `skills` are relative to the workspace root when `workspace` is a subfolder. A bare `contextSources` name is a file in that root. `seedPatch` stays a caller-repo path. Its hunks are relative to that workspace.

`--debug` retains an evidence bundle under `$TMPDIR/agent-spec/sessions/<id>/` by default. Use `--debug-dir` to override the parent directory.

Host SDK INFO lines stay hidden. Set `AGENT_TEST_HOST_LOGS=1` or `--debug` to print them.

A TTY run prints `agent started`, then updates an `agent` clock every 0.1s. Tool names and a short reply preview print as the host streams them. The clock line stays one row so the terminal can overwrite it. The HTML report line is a localhost link. A click opens the browser. The preview exits after 30 minutes idle. Set `AGENT_TEST_NO_REPORT_PREVIEW=1` to skip the preview.

`Ctrl+C` cancels active host work and deletes the temp folder. `--no-worktree` requires `AGENT_TEST_ALLOW_IN_PLACE=1` because agent edits will persist in the caller checkout.

## MCP servers

Scenarios can attach inline stdio or HTTP/SSE MCP servers through suite defaults or scenario overrides. Ambient project/user MCP configuration is not loaded. When `workspace` is a subfolder, stdio MCP cwd is the caller repo. Script args stay caller-relative.

## In-repo package checks

Default CI does not launch a paid agent:

```bash
bun run build
node packages/test/dist/cli.js --check --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --check --suites-dir agent-suites --suite smoke
```

Host-agent acceptance is `bun run test`. That command runs smoke, tools, mcp, judge, and depth on Cursor, Claude, and Codex. `bun run test:smoke`, `bun run test:tools`, `bun run test:mcp`, `bun run test:judge`, and `bun run test:depth` stay on Cursor. A key-gated GitHub Actions job runs the same suites on Cursor when `CURSOR_API_KEY` is present.
