# CLI

<!-- source-of-truth: agent-test CLI flags and check versus live -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-15 -->

<!-- review-deps: paths=packages/test/src/cli.ts,packages/test/src/theme.ts,packages/test/package.json,packages/test/src/worker-pool.ts,packages/test/src/viewer/**/*.ts,packages/test/src/html-report.ts -->

`agent-test` launches a host agent and scores the transcript. Every live run runs `--check` first.

Print the same flag list from the binary:

```bash
npx agent-test --help
```

## Check versus live

| Mode | Command | Agent |
| --- | --- | --- |
| Login | `npx agent-test login` | No |
| Check | `npx agent-test --check --suites-dir agent-suites` | No |
| Viewer | `npx agent-test viewer --suites-dir agent-suites` | After you click Run |
| Live | `npx agent-test --suites-dir agent-suites` | Yes |

`login` stores a Cursor SDK login in `~/.cursor/sdk/auth.json`. It does not print the key. Pass `--host openai` to run `codex login`. For Claude, run the Claude Code CLI login.

A TTY subscription run opens the Cursor login when that file is missing. `--check` reports the login file. It still does not fail the package check when the file is absent. A live run fails until you log in or pass `--auth-mode api-key`.

`--doctor`, `--validate-only`, `--validate-paths`, and `--validate-seeds` are aliases for `--check`.

`--check` inspects suite JSON, seed patches, the package, and host auth. A host that is not ready does not fail `--check`. A live run fails if that host is not ready.

## Selection

| Flag | Effect |
| --- | --- |
| `--suites-dir <path>` | Suite root. Default `agent-suites`. |
| `--suite <name>` | One suite folder name. |
| `--scenario <name>` | One scenario inside the selected suites. |
| `--host cursor\|claude\|openai\|all` | Adapter. Repeat or comma-separate for a matrix. Default is the suite `hosts` list, or `cursor`. |
| `--auth-mode subscription\|api-key` | Host billing mode. Default `subscription`. `--auth-method` is the same flag. |
| `--adapter <module>` | Load a consumer host adapter. Repeat for more than one module. |
| `--rubrics-dir <path>` | Extra rubric sidecar directory. |

A positional suite name is the same as `--suite`.

In-repo suites list `hosts: ["cursor", "claude", "openai"]`. A run without `--host` expands once per listed host. Pass `--host cursor` to pin one adapter.

## Suite viewer

`agent-test viewer` opens the unified localhost viewer with an empty run history. The catalog lists every suite and scenario before a run.

```bash
npx agent-test viewer --suites-dir agent-suites
```

The server binds `127.0.0.1` only. Cursor is selected by default. Host tabs list every suite host.

Run starts a live host agent. A progress bar shows how many tests finished, passed, failed, skipped, and remain. Each task includes a short **Starting context** summary that names supplied files, servers, tools, and skills. The recorded conversation shows the submitted task prompt. Setup, chat, scoring evidence, judge rationale, usage, trace details, and the final result all stay under the same scenario. Each host has its own tab; compare arms are tabbed. Cancel run stops the live host agent and moves through Cancelling to Cancelled.

The run selector keeps every run created during the current viewer process. Starting a rerun creates a new entry. You can inspect an older result while the active run continues; the running entry stays marked. History is not persisted after the viewer process exits. Hosts run together by default; `--workers` sets the shared live-agent limit. The viewer default is 4. The range is 1-32.

`--port` sets the listen port. `0` picks a free port.

`--compare-arm` is for isolated children. The viewer sets it when it starts one compare arm.

A missing host login fails that host cell. The catalog still loads.

## Scoring

| Flag | Effect |
| --- | --- |
| `--no-judge` | Skip LLM judge questions and `mustInvokeSkill` judge follow-up. Deterministic matchers still run. |
| `--fail-on all\|behavior\|infra-only` | Which failure classes fail the process. Default `all`. |
| `--allow-user-input` | Start a user simulator for AskQuestion-style tools. |
| `--timeout-ms <n>` | Agent deadline in milliseconds. Default `600000`, or `AGENT_TEST_TIMEOUT_MS`. |
| `--no-timeout` | Disable the deadline. |
| `--scenario-retries <n>` | Announce-stop retries. Default `AGENT_TEST_SCENARIO_RETRIES` or `1`. |
| `--workers <n>` | How many live agents run at once. Viewer default is 4. CLI default is 1. Range is 1-32. |

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

A TTY live run prints a `View report` localhost URL. It opens the same catalog-first viewer with the completed run selected, the whole suites directory available, and rerun controls active. That detached viewer exits after 30 minutes without page or API activity; browsing or starting a run resets the timer. It binds only to `127.0.0.1` and keeps at most one active run. Set `AGENT_TEST_NO_REPORT_PREVIEW=1` to skip the active viewer and print the self-contained HTML path instead. The **Starting context** summary remains available in either view.

A compare verdict lists checks under each arm. Each check shows pass or fail. A single scenario keeps the criteria and result labels.

`--debug-dir` inside the git repo prints a tip. Prefer `$TMPDIR` so debug files stay out of `git status`.

`Ctrl+C` cancels host work and deletes the sealed temp folder.

## Environment

The CLI does not load `.env`. Export variables in the shell. Copy `.env.example` in this repo.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_TEST_DEBUG` | Unset | Same as `--debug` when set. |
| `AGENT_TEST_HOST_LOGS` | Unset | Print host SDK INFO lines. `--debug` also prints them. |
| `AGENT_TEST_NO_REPORT_PREVIEW` | Unset | Skip the active viewer launched for a TTY report. |
| `AGENT_TEST_QUIET` | Unset | Reduce live clock output. |
| `AGENT_TEST_TIMEOUT_MS` | `600000` | Agent deadline. |
| `AGENT_TEST_LIVE_RETRIES` | `3` | Judge infrastructure attempts. |
| `AGENT_TEST_SCENARIO_RETRIES` | `1` | Announce-stop retries. |
| `AGENT_TEST_WORKERS` | Unset | Same as `--workers` when set. |
| `AGENT_TEST_SCENARIO_SETTLE_MS` | Adaptive | Delay between isolated child runs. |
| `AGENT_TEST_MAX_TURNS` | `6` | User-agent plus test-agent turns. |
| `AGENT_TEST_ALLOW_IN_PLACE` | Unset | Required for `--no-worktree`. |
| `AGENT_TEST_NO_WORKTREE` | Unset | Same as `--no-worktree` when set. |
| `AGENT_TEST_NO_ISOLATE` | Unset | Skip isolated child processes. |

Auth variables live in [hosts.md](hosts.md).

## In-repo scripts

| Script | What it runs |
| --- | --- |
| `bun run test` | Offline sandbox-safe product tests. |
| `bun run test:capabilities` | Eleven manual live `runAgentTest` capability checks on Cursor. |
| `bun run test:tour` | The seven-scenario product tour on Cursor. |
| `bun run test:matrix` | Capabilities on all built-in hosts. Run this manually. |
| `bun run test:sdk:consumer` | The installed-package contract without host credentials. |
| `bun run test:sdk:hosts` | The direct API smoke on all built-in hosts. Run this manually. |
| `bun run test:reliability` | Twenty Cursor capability runs. Run this manually. |
| `bun run test:e2e` | Playwright checks for the suite viewer and the HTML report. |

Pass extra flags after `--`:

```bash
bun run test:tour -- --scenario "answers from the project guide"
```

CI host jobs that use `CURSOR_API_KEY` must pass `--auth-mode api-key`.
