# Reliability

**Source of truth for** agent-spec reliability targets and verification commands.

<!-- doc-meta: owner=eng | last-reviewed=2026-09-02 -->

Every scenario execution launches Cursor or Claude. Replay-based testing is deprecated and removed; JSON suites only configure direct runs.

## Targets

| Surface | Target |
| --- | --- |
| Direct agent runs | At least 95% completion without infrastructure-only failure over 20 credentialed runs |
| Seed patches | 100% apply cleanly through `--validate-seeds` |
| Configuration | Zero silent misconfigurations through `--validate-only` |
| Isolation | Zero caller-worktree mutations outside the owned scenario worktree |

## Verification commands

```bash
# Structural and semantic suite validation; does not launch an agent
node packages/test/dist/cli.js --validate-only --suites-dir agent-suites

# Include seedPatch path checks
node packages/test/dist/cli.js --validate-only --validate-paths --suites-dir agent-suites

# Apply each seed patch in a temporary worktree; does not launch an agent
node packages/test/dist/cli.js --validate-seeds --suites-dir agent-suites

# Install and provider readiness
node packages/test/dist/cli.js --doctor

# Direct Cursor execution (default host)
node packages/test/dist/cli.js --fail-on=behavior --suites-dir agent-suites

# Direct Claude execution
node packages/test/dist/cli.js --host claude --no-judge --suites-dir agent-suites

# Direct paired runs and offline comparison of their reports
node packages/test/dist/cli.js --compare-pairs skeleton-clean:skeleton-messy --out-dir "$TMPDIR/compare"
node packages/test/dist/cli.js compare --a a.suite-report.json --b b.suite-report.json --out-dir "$TMPDIR/compare"
```

## Signals and failures

Provider usage is captured on `AgentTrace` and `ScenarioResult`; summaries and HTML reports include token totals and percentiles. Read/tool matchers provide deterministic grounding signals. Fuzzy `judge` criteria run against the real trace and require `CURSOR_API_KEY`.

| Category | Meaning | `--fail-on=behavior` |
| --- | --- | --- |
| `rubric_miss` | Deterministic or judged behavior failed | Fails |
| `judge_parse` | Judge returned an unusable contract | Fails |
| `judge_infra` | Judge SDK, network, or rate-limit failure | Ignored |
| `agent_runtime` | Agent timeout, OOM, user-input request, or host failure | Ignored |
| `worktree_leak` | Agent mutated the caller checkout | Fails |
| `recording_error` | Required transient trace or result persistence failed | Fails |

## Environment controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_TEST_LIVE_RETRIES` | `3` | Judge infrastructure attempts |
| `AGENT_TEST_SCENARIO_RETRIES` | `1` | Direct announce-stop scenario retries |
| `AGENT_TEST_SCENARIO_SETTLE_MS` | Adaptive | Delay between isolated direct-run subprocesses |
| `AGENT_TEST_TIMEOUT_MS` | `600000` | Direct agent deadline |
| `AGENT_TEST_DEBUG` | Unset | Retain evidence-rich debug bundles |
