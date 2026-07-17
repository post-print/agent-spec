# @post-print/agent-test

**Source of truth for** agent-test package.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-16 -->

Jest-shaped agent scenario runner built on `@post-print/agent-harness`.

## In-repo smoke (this monorepo)

After `bun run build` at the repo root:

```bash
node packages/test/dist/cli.js --suites-dir packages/test/fixtures --suite smoke
node packages/test/dist/cli.js --doctor
```

There is no top-level `agent-suites/` here — consumer examples below assume a consuming repo. Live `--live` needs an **exported** `CURSOR_API_KEY` for Cursor (default) or `ANTHROPIC_API_KEY` for `--host claude` (copy repo-root `.env.example`; the CLI does not auto-load `.env`). Judge classifiers still need `CURSOR_API_KEY` unless you pass `--no-judge`.

## CLI (consumers, Node >= 22)

Works under **Node >= 22** (the published `agent-test` bin):

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --suite ambient-routing
npx agent-test --suites-dir agent-suites --live --suite ambient-routing   # exported CURSOR_API_KEY required
npx agent-test --suites-dir agent-suites --live --host claude --suite ambient-routing  # ANTHROPIC_API_KEY + claude CLI
npx agent-test --live --compare-pairs skeleton-clean:skeleton-messy --out-dir "$TMPDIR/compare"
npx agent-test compare --a clean.suite-report.json --b messy.suite-report.json --out-dir "$TMPDIR/compare"
npx agent-test --doctor
```

Bun is fine for local package development (`bun install` / `bun run build` in this monorepo), but consumers do not need Bun to run suites.

Default suites root: `agent-suites/` (must exist, or pass `--suites-dir`).

Live output always uses ANSI color (including under Cursor agent shells that set `NO_COLOR`).

## Environment variables

See repo-root `.env.example`. Common knobs:

| Variable                                    | Purpose                                                       |
| ------------------------------------------- | ------------------------------------------------------------- |
| `CURSOR_API_KEY`                            | Required for `--live` Cursor and judge classifiers            |
| `ANTHROPIC_API_KEY`                         | Required for `--live --host claude`                           |
| `CLAUDE_CODE_BIN`                           | Optional path to Claude Code CLI binary                       |
| `CLAUDE_AGENT_MODEL`                        | Optional Claude model override                                |
| `CLAUDE_CODE_ALLOWED_TOOLS`                 | Optional `--allowedTools` list for Claude live runs           |
| `AGENT_TEST_DEBUG`                          | Same as `--debug` when `1`/`true`                             |
| `AGENT_TEST_VERBOSE`                        | Extra tips (e.g. OOM isolation) when `1`                      |
| `AGENT_TEST_VERBOSE_PATHS`                  | Print full paths when `1`                                     |
| `AGENT_TEST_QUIET`                          | Suppress progress when `1`                                    |
| `AGENT_TEST_TIMEOUT_MS`                     | Live hard timeout (default 600000; `0` disables)              |
| `AGENT_TEST_LIVE_RETRIES`                   | Judge infra retry attempts (default 3)                        |
| `AGENT_TEST_SCENARIO_RETRIES`               | Live announce-stop scenario retries (default 1; `0` disables) |
| `AGENT_TEST_ALLOW_IN_PLACE`                 | Allow `--no-worktree` live runs when `1`                      |
| `AGENT_TEST_NO_WORKTREE`                    | Disable worktree isolation when `1`/`true`                    |
| `AGENT_TEST_NO_ISOLATE`                     | Disable isolated subprocesses when `1`                        |
| `AGENT_TEST_SCENARIO_SETTLE_MS`             | Settle delay between live scenarios                           |
| `CURSOR_AGENT_MODEL` / `CURSOR_JUDGE_MODEL` | Optional model overrides                                      |
| `CURSOR_JUDGE_TEMPERATURE`                  | Optional judge temperature                                    |

## Debug mode

```bash
npx agent-test --suites-dir agent-suites --suite smoke --debug
npx agent-test --suites-dir agent-suites --live --debug
npx agent-test --suites-dir agent-suites --live --debug --debug-dir "$TMPDIR/agent-test-debug"
```

`--debug` (or `AGENT_TEST_DEBUG=1`) implies `--keep-recordings`, verbose failure detail, and full paths. Every non-skipped scenario writes a bundle under the session root:

```
sessions/<id>/<suite>/<scenario>.debug/
  summary.md             # verdict + Why (category hint + evidence + trace stats)
  transcript.md          # Why, prompt, rubric, interleaved messages/tools (incl. results), failures
  scenario.json          # prompt + rubric + seed metadata
  result.json            # pass/fail, duration, failures, usage, skillsInvoked, routing, counts
  trace.json
  failures.json          # includes category + evidence
  judge-debug.json       # when judge criteria ran (SDK status/error, sizes, attempt)
  environment.json       # versions/models/timeout/isolation; API keys only as booleans
  rerun.sh               # shell-quoted exact re-run command (export API keys yourself)
```

**Debug dir default:** omit `--debug-dir` to stage under `$TMPDIR/agent-spec/sessions/<id>/…` (outside the repo). Passing an in-repo `--debug-dir` (for example `./agent-test-debug`) is supported — harness staging paths under that dir are excluded from worktree leak checks — but prefer `$TMPDIR` so debug artifacts never appear in `git status`.

`--debug-dir <path>` replaces `$TMPDIR/agent-spec` as the sessions parent (`<path>/sessions/<id>/…`).

Failure categories printed on FAIL lines and in `failures.json`:

| Category          | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `rubric_miss`     | Assertion/judge criterion miss                                                         |
| `judge_infra`     | Judge SDK/API failure (not a criterion miss)                                           |
| `agent_runtime`   | Agent session error, timeout, AskQuestion, subprocess exit                             |
| `worktree_leak`   | Live agent mutated the caller working tree (harness `--debug-dir` staging is excluded) |
| `recording_error` | Failed to persist a staging/fixture trace                                              |

**Cancel:** `Ctrl+C` (SIGINT) kills in-flight isolated scenario subprocesses and best-effort cancels the active Cursor SDK run, then cleans scenario worktrees.

## Live dogfood

Live runs need `CURSOR_API_KEY` and a suites directory that exists. Preflight fails when the resolved suites directory is missing (default `agent-suites/` if `--suites-dir` is omitted).

Passing live runs write staging traces under `$TMPDIR/agent-spec/sessions/<pid>-<timestamp>/` (removed on exit unless `--keep-recordings`). Use `--record-fixtures` to overwrite each scenario's committed `replayTrace` path. `--no-worktree` requires `AGENT_TEST_ALLOW_IN_PLACE=1`.

Live agent runs have a **hard timeout** (default **10 minutes**, override with `--timeout-ms` or `AGENT_TEST_TIMEOUT_MS`; disable with `--no-timeout` or `AGENT_TEST_TIMEOUT_MS=0`). If the agent invokes `AskQuestion` or similar user-input tools, the harness fails fast with a clear error — live mode is single-shot and cannot supply follow-up turns. Use `--allow-user-input` only for intentional multi-turn dogfood (the run may still hang waiting for stdin).

Announce-stop flakes (agent exits after Routing with no tools) are retried once by default on live runs (`AGENT_TEST_SCENARIO_RETRIES=1` or `--scenario-retries 1`; set `0` to disable). This is separate from `AGENT_TEST_LIVE_RETRIES` (judge infra only).

### Dialogue skills in live runs

Skills that expect multi-turn Socratic dialogue (for example `crystallize`) will hang or fail in `--live` unless the scenario is written for one-shot completion:

- **Replay-only** — commit a golden trace where the agent finishes without asking questions; use `host: "replay"` or `skip: true` with live skipped at suite level.
- **One-shot live prompt** — instruct the agent to mirror intent and emit the final artifact in a single turn (`no AskQuestion; produce Crystallized idea now`).
- **Ambient routing** — fuzzy-intent scenarios that only require mirroring + one assumption are naturally one-shot; full crystallize dialogue is not.

Do not weaken dialogue-first product skills for CI; reshape the suite contract instead.

## MCP servers

Live Cursor runs can attach **inline** MCP servers from suite/scenario JSON. Ambient project/user MCP (`.cursor/mcp.json`) is not loaded — tests stay hermetic.

```json
{
  "defaults": {
    "mcpServers": {
      "docs": {
        "type": "http",
        "url": "https://example.com/mcp",
        "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }
      }
    }
  },
  "scenarios": [
    {
      "name": "use echo",
      "prompt": "Call the echo tool with text hello.",
      "mcpServers": {
        "echo": {
          "type": "stdio",
          "command": "node",
          "args": ["packages/test/fixtures/mcp-echo/server.mjs"]
        }
      },
      "rubric": {
        "mustCallTool": ["echo:hello"],
        "mustNotCallTool": ["shell"]
      }
    }
  ]
}
```

- Suite `defaults.mcpServers` merge with scenario `mcpServers` by server name (scenario wins).
- `${ENV_VAR}` placeholders expand in `command`, `args`, `env`, `url`, `headers`, and OAuth fields at run time.
- Rubric `mustCallTool` / `mustNotCallTool` match tool **name** substrings (works with MCP name prefixes). Use `name:argFragment` to also require a substring in JSON args.
- Rubric `mustReadPath` / `mustNotReadPath` match substrings on **Read** tool JSON args (registry-first / avoid inventing paths). Keep hallucination scoring in live `judge` questions — no heavy factuality engine in v1.
- Suite defaults may set `profile: "skeleton"` and/or `contextSources` (additive paths / `.skeleton/customize/` basenames). Shared/cursor/claude defaults stay backwards-compatible.
- Live runs surface provider `usage` on traces/results; suite summary + HTML report include token sum / p50 / p95 when present.
- `--compare-pairs A:B` (or `agent-test compare --a/--b`) pairs scenarios by name and writes `compare-report.json` / `.md` / `.html` with pass/fail, tokens, toolCallCount, durationMs, and skill/registry hop proxies. Suite HTML also embeds an A/B table when two reports are present.
- Replay hosts ignore `mcpServers` but still score recorded `toolCalls` against those matchers.

## Library

```ts
import { runAllSuites, expectTrace } from "@post-print/agent-test";
```
