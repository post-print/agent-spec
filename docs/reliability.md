# Reliability

<!-- source-of-truth: agent-spec reliability targets and verification commands -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-15 -->

<!-- review-deps: paths=package.json,agent-suites/**/scenarios.json -->

`bun run test` and `bun run test:unit` do not launch a host agent. JSON suites only configure direct runs. Provider-backed capability, tour, matrix, and reliability runs are manual.

How to run: [getting-started.md](getting-started.md). Flags: [cli.md](cli.md).

## Targets

| Surface | Target |
| --- | --- |
| Each capability scenario | At least 19 of 20 runs have no behavior failure |
| Each capability scenario | At least 19 of 20 runs have no infrastructure failure |
| Judge scenario | At least 19 of 20 judge passes |
| Qualification run | No worktree leak, recording error, or judge-format error |
| Deterministic controls | Every known-good and known-bad control returns the expected verdict |
| Seed patches | 100% apply cleanly through `--check` |
| Configuration | Zero silent misconfigurations through `--check` |
| Isolation | Zero tool paths outside the sealed temp workspace. Host-global user skills stay out unless `allowUserSkills` is true |

## Verification commands

```bash
# Suite, seed, package, and host check. Does not launch an agent.
# Host not ready does not fail this command.
node packages/test/dist/cli.js --check --suites-dir agent-suites

# Offline product tests.
bun run test

# Manual live capability suite and product tour.
bun run test:capabilities
bun run test:tour

# Manual host and reliability work.
bun run test:matrix
bun run test:sdk:hosts
bun run test:reliability

# Package contract. This does not use host credentials.
bun run test:sdk:consumer
```

The 20-run command runs the deterministic controls first. It then runs the eleven Cursor capability scenarios 20 times. It prints the count for each scenario and fails when any threshold is missed.

For compare scenarios, qualify the experiment result, not the number of arm
transcripts. A declared failed control is an expected measurement. It is not a
reliability failure when the outcome gate accepts it. Infrastructure, isolation,
recording, and judge-format errors always remain failures.

## Signals and failures

Provider usage is captured on `AgentTrace` and `ScenarioResult`. Read/tool matchers provide deterministic grounding signals. Fuzzy `judge` criteria run against the full transcript, including tool calls and tool results. The judge uses the same host family as the test agent.

| Category | Meaning | `--fail-on=behavior` |
| --- | --- | --- |
| `rubric_miss` | Deterministic or judged behavior failed | Fails |
| `judge_parse` | Judge returned an unusable contract | Fails |
| `judge_infra` | Judge SDK, network, or rate-limit failure | Ignored |
| `agent_runtime` | Agent timeout, OOM, user-input request, or host failure | Ignored |
| `worktree_leak` | Agent used paths outside the sealed workspace, or mutated the caller checkout | Fails |
| `recording_error` | Required transient trace or result persistence failed | Fails |

## Environment controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_TEST_LIVE_RETRIES` | `3` | Judge infrastructure attempts |
| `AGENT_TEST_SCENARIO_RETRIES` | `1` | Direct announce-stop scenario retries |
| `AGENT_TEST_SCENARIO_SETTLE_MS` | Adaptive | Delay between isolated direct-run subprocesses |
| `AGENT_TEST_TIMEOUT_MS` | `600000` | Direct agent deadline |
| `AGENT_TEST_DEBUG` | Unset | Retain evidence-rich debug bundles |
| `AGENT_TEST_MAX_TURNS` | `6` | User-agent plus test-agent conversation turns |
| `CURSOR_AUTH_MODE` | Unset | Fallback when `--auth-mode` is omitted. Default is subscription. |
| `CLAUDE_AUTH_MODE` | Unset | Fallback when `--auth-mode` is omitted. Default is subscription. |
| `OPENAI_AUTH_MODE` | Unset | Fallback when `--auth-mode` is omitted. Default is subscription. |
