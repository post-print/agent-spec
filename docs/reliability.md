# Reliability

**Source of truth for** agent-spec reliability targets and verification commands.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-16 -->

## Targets (4.5+)

| Surface      | SLO                                                 |
| ------------ | --------------------------------------------------- |
| Replay CI    | 50/50 deterministic passes on consumer suites       |
| Live dogfood | ≤5% infra-only failures over 20 runs (with retries) |
| Seed patches | 100% apply cleanly via `--validate-seeds`           |
| Config       | Zero silent misconfigurations (`--validate-only`)   |

## Verification commands

```bash
# Structural + semantic suite validation
node packages/test/dist/cli.js --validate-only --suites-dir agent-suites

# Include replayTrace / seedPatch path checks
node packages/test/dist/cli.js --validate-only --validate-paths --suites-dir agent-suites

# Seed patch drift detection (applies each patch in a temp worktree)
node packages/test/dist/cli.js --validate-seeds --suites-dir agent-suites

# Install / live readiness
node packages/test/dist/cli.js --doctor

# CI replay (default)
node packages/test/dist/cli.js --suites-dir agent-suites

# Live dogfood — ignore infra flakes in exit code
node packages/test/dist/cli.js --live --fail-on=behavior --suites-dir agent-suites

# Paired A/B compare (shared scenario names across two suite dirs)
node packages/test/dist/cli.js --live --compare-pairs skeleton-clean:skeleton-messy --out-dir "$TMPDIR/compare"
node packages/test/dist/cli.js compare --a a.suite-report.json --b b.suite-report.json --out-dir "$TMPDIR/compare"
```

## Token / grounding metrics

| Signal | Where |
| ------ | ----- |
| `usage.totalTokens` (plus input/output when reported) | `AgentTrace` / `ScenarioResult` / debug `result.json` |
| Suite token sum / p50 / p95 | Console summary + HTML report |
| `mustReadPath` / `mustNotReadPath` | Deterministic Read-arg substring rubrics (registry-first proxies) |
| Hallucination scoring | Live `judge` questions authored in suites (no factuality engine in v1) |

## Failure categories

| Category          | Meaning                              | `--fail-on=behavior`                          |
| ----------------- | ------------------------------------ | --------------------------------------------- |
| `rubric_miss`     | Deterministic assertion failed       | Fails                                         |
| `judge_parse`     | Judge returned unparseable JSON      | Fails                                         |
| `judge_infra`     | SDK/network/rate limit (retried)     | Ignored                                       |
| `agent_runtime`   | Agent timeout, OOM, user-input tool  | Ignored                                       |
| `worktree_leak`   | Caller repo mutated outside worktree | Fails (seed-target index noise auto-restored) |
| `recording_error` | Trace write failed                   | Fails                                         |

## Environment knobs

| Variable                        | Default                                        | Purpose                                            |
| ------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `AGENT_TEST_LIVE_RETRIES`       | `3`                                            | Judge infra retry attempts                         |
| `AGENT_TEST_SCENARIO_RETRIES`   | `1`                                            | Live announce-stop scenario retries (`0` disables) |
| `AGENT_TEST_SCENARIO_SETTLE_MS` | adaptive (`500` after pass, `5000` after fail) | Subprocess settle delay                            |
| `AGENT_TEST_TIMEOUT_MS`         | `600000`                                       | Live harness deadline                              |
| `AGENT_TEST_DEBUG`              | unset                                          | Verbose failures + debug bundles (all non-skipped) |
