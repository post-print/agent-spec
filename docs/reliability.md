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

A pass is default-deny. agent-test exits 0 only on a path listed in `EXIT_ZERO_PATHS` (`packages/test/src/sdk/verdict.ts`), and each path names the evidence it needs. A verdict that reaches exit 0 without that evidence becomes `instrument_error`. Property tests over generated runs (`packages/test/src/__tests__/verdict-properties.test.ts`) check the rules every run must keep. Exit 0 needs a test or plan that passed on its own evidence. A failure is charged to the agent only on typed evidence that the agent caused it. That evidence is a check that failed after the agent started, the agent's own outcome as its host reported it (`AgentOutcomeError`, or a run that left its workspace), or a control that survived. The test's own code failing, such as a `TypeError` in a helper, is `author_error`. An operation that failed for a reason nobody typed is `instrument_error`. Neither is ever charged to the agent. The verdict does not depend on the order attempts arrive in.

## Controls

A control proves a test could have gone the other way. There are two shapes.

| Control | What changes | Runs |
| --- | --- | --- |
| Behavior control | A scripted host does the wrong thing against the real suites. A correct script must pass and each bad one must fail on the named check. | Offline, in `bun run test:sdk:contracts`. Listed in `agent-suites/controls/manifest.ts`. |
| Subject control | The subject is sabotaged and a real agent runs. | Live, in `bun run test:controls`. |

Write a subject control as the same check under a broken subject, marked with `info.fail()`. A control earns its result only when an `expect` fails the test after an agent operation started. A check the test caught does not count. If it passes on any attempt or in any sample, the run ends as `control_survived` and exits 1, even for a rate with no plan. If the host broke, or the test threw for another reason such as a setup error, the run has no verdict. `agent-suites/reference/` holds one working example for each question type: discovery, clarity, cold start, teardown, and judges.

## Exit codes

The CLI exit code comes from one verdict, stored in the execution summary and read by the viewer.

| Exit | Verdict | Meaning |
| --- | --- | --- |
| 0 | `passed` | Every test that ran passed, on the first try, every sampling plan cleared or every `--repeat-each` repeat passed, and the runner agrees. |
| 0 | `listed` | `--list` only. No test ran. |
| 3 | `indicative` | Rates were reported, with no plan to decide them: `samples` with no `flagAt`, or `--repeat-each` with `--measure`. Nothing failed, but nothing passed either. |
| 1 | `agent_failed` | A check failed after the agent started, the host reported the agent's own terminal failure, the agent left its workspace, a repeat from `--repeat-each` failed, a sampling plan flagged, or a claim regressed from its baseline. A real failure outranks any test with no verdict. |
| 1 | `control_survived` | A control that must fail passed, so its test cannot tell good from bad. |
| 2 | `infra_invalid` | The host or runner failed, so nothing is known about the agent. |
| 2 | `conditions_unknown` | The run cannot show what a test asked about, a comparison's arms differ beyond its subject or one has no verdict, or a sampled run found a baseline file it cannot read. |
| 2 | `vacuous` | A test finished without earning its result: no agent operation completed, a run failed before its host started, for example on a missing workspace or skill or an exhausted snapshot budget, or a control failed for a reason other than a check. |
| 2 | `flaky` | A test failed and then passed on retry. Every attempt is kept. |
| 2 | `skipped_only` | No test ran. |
| 2 | `interrupted` | The run was stopped, a test it set out to run never started, for example under `--max-failures`, or an attempt never finished. |
| 2 | `author_error` | The test's own code failed, not a check and not an agent operation, so nothing is known about the agent. |
| 2 | `instrument_error` | The runner and the recorded attempts disagree, an agent or judge operation failed for a reason nobody typed, a failure has no recorded error, the samples of one test disagree on their plan, or a verdict reached exit 0 without the evidence its path needs. |

`--allow-indicative` makes an indicative run exit 0 for a caller that only wants the rates. The stored verdict keeps `indicative` and records `indicativeAllowed`, and the CLI says that exit 0 came from the flag. Runs stored before v5 named this verdict `measured`; the viewer reads them as indicative.

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
bun run test:controls
```

The reliability command repeats the eleven TypeScript capability tests twenty times on the default OpenAI agent, with no retries, and reports each test's rate with its interval. It passes `--measure` to set no threshold, because requiring every repetition to pass would wrongly fail a 95% behavior 64% of the time. So the run is `indicative` and exits 3. To decide on a rate, use a [sampling plan](sdk-v2.md#rates-and-comparisons). The separately configured reviewer also needs authentication.

Missing usage never becomes zero or a partial average. Agent and judge usage are reported separately. Token differences across providers do not imply equivalent cost. An interval assumes independent runs, and same-day provider state can correlate them, so it can be optimistic; spread a qualifying run across days when that matters. A rate does not carry over to other prompts, tasks, or models.

The strict Biome policy is a required gate across the repository, including retained host and viewer code. Run `bun run lint` to check for zero errors and warnings. Passing runtime tests does not replace lint validation.
