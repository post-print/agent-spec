# Reliability

**Source of truth for** agent-spec reliability targets and verification commands.

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

`bun run test:unit` does not launch a paid agent. `bun run test` launches Cursor, Claude, or OpenAI Codex. Replay-based testing is deprecated and removed. JSON suites only configure direct runs.

## Targets

| Surface | Target |
| --- | --- |
| Direct agent runs | At least 95% completion without infrastructure-only failure over 20 credentialed runs |
| Seed patches | 100% apply cleanly through `--check` |
| Configuration | Zero silent misconfigurations through `--check` |
| Isolation | Zero tool paths outside the sealed temp workspace |

## Verification commands

```bash
# Suite, seed, package, and host check. Does not launch an agent.
# Host not ready does not fail this command.
node packages/test/dist/cli.js --check --suites-dir agent-suites

# Direct Cursor execution (default host). Incurs provider usage.
bun run test

# Direct Claude execution
node packages/test/dist/cli.js --host claude --suites-dir agent-suites --suite smoke

# Direct OpenAI execution
node packages/test/dist/cli.js --host openai --suites-dir agent-suites --suite smoke

# Offline comparison of existing reports
node packages/test/dist/cli.js compare --a a.suite-report.json --b b.suite-report.json --out-dir "$TMPDIR/compare"
```

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
