# CLI

<!-- source-of-truth: agent-test CLI flags and check versus live -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-14 -->

<!-- review-deps: paths=packages/test/src/cli.ts,packages/test/src/theme.ts,packages/test/package.json -->

`agent-test` launches a host agent and scores the transcript. Every live run runs `--check` first.

Print the same flag list from the binary:

```bash
npx agent-test --help
```

## Check versus live

| Mode | Command | Agent |
| --- | --- | --- |
| Check | `npx agent-test --check --suites-dir agent-suites` | No |
| Live | `npx agent-test --suites-dir agent-suites` | Yes |

`--doctor`, `--validate-only`, `--validate-paths`, and `--validate-seeds` are aliases for `--check`.

`--check` inspects suite JSON, seed patches, the package, and host auth. A host that is not ready does not fail `--check`. A live run fails if that host is not ready.

## Selection

| Flag | Effect |
| --- | --- |
| `--suites-dir <path>` | Suite root. Default `agent-suites`. |
| `--suite <name>` | One suite folder name. |
| `--scenario <name>` | One scenario inside the selected suites. |
| `--host cursor\|claude\|openai\|all` | Adapter. Repeat or comma-separate for a matrix. Default is the suite `hosts` list, or `cursor`. |
| `--adapter <module>` | Load a consumer host adapter. Repeat for more than one module. |
| `--rubrics-dir <path>` | Extra rubric sidecar directory. |

A positional suite name is the same as `--suite`.

In-repo suites list `hosts: ["cursor", "claude", "openai"]`. A run without `--host` expands once per listed host. Pass `--host cursor` to pin one adapter.

## Scoring

| Flag | Effect |
| --- | --- |
| `--no-judge` | Skip LLM judge questions and `mustInvokeSkill` judge follow-up. Deterministic matchers still run. |
| `--fail-on all\|behavior\|infra-only` | Which failure classes fail the process. Default `all`. |
| `--allow-user-input` | Start a user simulator for AskQuestion-style tools. |
| `--timeout-ms <n>` | Agent deadline in milliseconds. Default `600000`, or `AGENT_TEST_TIMEOUT_MS`. |
| `--no-timeout` | Disable the deadline. |
| `--scenario-retries <n>` | Announce-stop retries. Default `AGENT_TEST_SCENARIO_RETRIES` or `1`. |

`--fail-on=behavior` ignores `judge_infra` and `agent_runtime`. In-repo scripts use that mode. Categories live in [reliability.md](reliability.md).

Removed flags fail with a message: `--live`, `--record`, `--record-fixtures`, `--compare-pairs`, `--a`, `--b`.

## Reports and debug

| Flag | Effect |
| --- | --- |
| `--report-out <path>` | HTML report file or directory. |
| `--no-html-report` | Skip the HTML report. |
| `--debug` | Keep recordings and write a debug bundle. |
| `--debug-dir <path>` | Parent directory for that bundle. Default `$TMPDIR/agent-spec`. |
| `--no-worktree` | Run in the caller checkout. Needs `AGENT_TEST_ALLOW_IN_PLACE=1`. |

A TTY live run prints a localhost HTML preview. Cmd-click the `http://` URL to open the browser. The preview exits after 30 minutes idle. Set `AGENT_TEST_NO_REPORT_PREVIEW=1` to skip it. That prints a file path. Cursor opens the file path in the editor.

`--debug-dir` inside the git repo prints a tip. Prefer `$TMPDIR` so debug files stay out of `git status`.

`Ctrl+C` cancels host work and deletes the sealed temp folder.

## Environment

The CLI does not load `.env`. Export variables in the shell. Copy `.env.example` in this repo.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_TEST_DEBUG` | Unset | Same as `--debug` when set. |
| `AGENT_TEST_HOST_LOGS` | Unset | Print host SDK INFO lines. `--debug` also prints them. |
| `AGENT_TEST_NO_REPORT_PREVIEW` | Unset | Skip the TTY HTML preview. |
| `AGENT_TEST_QUIET` | Unset | Reduce live clock output. |
| `AGENT_TEST_TIMEOUT_MS` | `600000` | Agent deadline. |
| `AGENT_TEST_LIVE_RETRIES` | `3` | Judge infrastructure attempts. |
| `AGENT_TEST_SCENARIO_RETRIES` | `1` | Announce-stop retries. |
| `AGENT_TEST_SCENARIO_SETTLE_MS` | Adaptive | Delay between isolated child runs. |
| `AGENT_TEST_MAX_TURNS` | `6` | User-agent plus test-agent turns. |
| `AGENT_TEST_ALLOW_IN_PLACE` | Unset | Required for `--no-worktree`. |
| `AGENT_TEST_NO_WORKTREE` | Unset | Same as `--no-worktree` when set. |
| `AGENT_TEST_NO_ISOLATE` | Unset | Skip isolated child processes. |

Auth variables live in [hosts.md](hosts.md).

## In-repo scripts

| Script | What it runs |
| --- | --- |
| `bun run test` | All in-repo suites on Cursor, Claude, and Codex. `--fail-on=behavior`. |
| `bun run test:smoke` | `smoke` on Cursor. |
| `bun run test:tools` | `tools` on Cursor. |
| `bun run test:mcp` | `mcp` on Cursor. |
| `bun run test:judge` | `judge` on Cursor. |
| `bun run test:depth` | `depth` on Cursor. |

Pass extra flags after `--`:

```bash
bun run test -- --host cursor --suite smoke
```
