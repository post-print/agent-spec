# Reliability

<!-- source-of-truth: offline checks and manual provider proof -->
<!-- doc-meta: owner=eng -->
<!-- review-deps: paths=package.json#scripts,agent-suites/**/*.ts,.github/workflows/test.yml -->

## What a result means

agent-test turns a question about how agents behave into evidence you can act on. The thing under test can be anything an agent touches: a tool, a description, a doc, a skill, a repo, a model, or the agent itself. Every test is a small experiment, and each result makes a claim: under these recorded conditions, with this subject, agents did X in k of n runs, and this control shows the test could have gone the other way.

A result earns trust by answering four questions, in order. Each is meaningless until the one before it holds.

| Question | Answered by | If the answer is no |
| --- | --- | --- |
| Did the run really happen? | Terminal events, typed failures, the operation ledger | No verdict. Fix the instrument. |
| Were the conditions what we claim? | `run.record`, `run.exposure`, `run.environment`, the host probe | No verdict. The result is about a different experiment. |
| Could it have gone the other way? | Controls | The pass means nothing yet. |
| How strong is the claim? | Sample size, interval, baseline | Report what it is: "1 of 1", not "works". |

Before adding a test, name the subject, the question, the evidence it reads, and the control that would make it fail.

## Exit codes

The CLI exit code comes from one verdict, stored in the execution summary and read by the viewer.

| Exit | Verdict | Meaning |
| --- | --- | --- |
| 0 | `passed` | Every test that ran passed, on the first try, and the runner agrees. |
| 0 | `listed` | `--list` only. No test ran. |
| 1 | `agent_failed` | A test's checks failed. A real failure outranks any test with no verdict. |
| 2 | `infra_invalid` | The host or runner failed, so nothing is known about the agent. |
| 2 | `conditions_unknown` | The run cannot show what a test asked about. |
| 2 | `vacuous` | A test finished without earning its result. |
| 2 | `flaky` | A test failed and then passed on retry. Every attempt is kept. |
| 2 | `skipped_only` | No test ran. |
| 2 | `interrupted` | The run was stopped. |
| 2 | `instrument_error` | The runner and the recorded attempts disagree. |

## Offline and live proof

Offline checks do not establish live provider reliability. Unit tests cover retained host capture/isolation and viewer behavior; SDK contracts use a fake adapter to prove resource ownership, parallel tasks, continuation, selected judge input, schema validation, rejection of a run that leaves its workspace, and rejection of a test that did not earn its result. Fake hosts prove that empty, garbage, truncated, killed, and unauthenticated runs are never recorded as completed, and `packages/test/fixtures/instrument` drives a scripted host through the real runner to fix the verdict and exit code of each outcome. They do not prove what a real host emits.

Offline tests prove the harness builds the right host arguments and rejects escapes. Only a live run proves the host enforces them. The capability suite's escape probe is that live gate: a canary in the checkout must never reach the agent's transcript or tool results, whether the agent refuses or tries. Run it after changing host isolation or upgrading a host CLI.

```sh
bun run test:unit
bun run test:sdk:contracts
bun run test:sdk:consumer
bun run test:e2e
```

Provider-backed runs are manual and consume the configured host credentials:

```sh
bun run test:tour
bun run test:capabilities
bun run test:matrix
bun run test:reliability
bun run test:probe
```

The reliability command repeats the eleven TypeScript capability tests twenty times on the default OpenAI agent, with no retries. It now requires every repetition to pass. This replaces the old JSON-specific 19-of-20 classifier/category calculation; there is no second scoring pipeline. The separately configured reviewer also needs authentication.

Missing usage never becomes zero or a partial average. Agent and judge usage are reported separately. Token differences across providers do not imply equivalent cost. A few repeated runs are not statistical qualification.

The strict Biome policy is a required gate across the repository, including retained host and viewer code. Run `bun run lint` to check for zero errors and warnings. Passing runtime tests does not replace lint validation.
