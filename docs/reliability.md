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

A pass also needs conditions that can carry it. The claim's strength is part of the verdict, not only a label in the viewer: a run whose records fall short becomes `indicative`, and its reasons are printed after the verdict. Run `bun run test:probe` to calibrate a host. Use API-key auth with `loadProjectContext: false` on Claude to keep the host's own configuration out, and add `--verdict-grade` to refuse any agent that cannot and to seal the real home; see [verdict-grade runs](isolation.md#verdict-grade-runs).

A pass is default-deny. agent-test exits 0 only on a path listed in `EXIT_ZERO_PATHS` (`packages/test/src/sdk/verdict.ts`), and each path names the evidence it needs. A verdict that reaches exit 0 without that evidence becomes `instrument_error`. Property tests over generated runs (`packages/test/src/__tests__/verdict-properties.test.ts`) check the rules every run must keep. Exit 0 needs a test or plan that passed on its own evidence. A failure is charged to the agent only on typed evidence that the agent caused it. That evidence is a check that failed after the agent started, the agent's own outcome as its host reported it (`AgentOutcomeError`, or a run that left its workspace), or a control that survived. The test's own code failing, such as a `TypeError` in a helper, is `author_error`. An operation that failed for a reason nobody typed is `instrument_error`. Neither is ever charged to the agent. The verdict does not depend on the order attempts arrive in.

## Controls

A control proves a test could have gone the other way. There are two shapes.

| Control | What changes | Runs |
| --- | --- | --- |
| Behavior control | A scripted host does the wrong thing against the real suites. Each control runs through agent-test itself: a correct script must end `passed` with exit 0, and each bad one `agent_failed` with exit 1 on the named check. | Offline, in `bun run test:sdk:contracts`. Listed in `agent-suites/controls/manifest.ts`. |
| Subject control | The subject is sabotaged and a real agent runs. | Live, in `bun run test:controls`. |

Write a subject control as the same check under a broken subject, and name the check the sabotage must break: `control: { mustFail: "The agent called the tool." }` in the test's details. Break the subject so every precondition still holds and only that check can fail. A control earns its result only when an `expect` fails the test after an agent operation started, and, when it names a check, only when that labelled check is the one that failed. Failing on any other check, such as a precondition, gives `vacuous`. A bare `info.fail()` still marks a control, but accepts any failed check, so it can pass without testing what it should. A check the test caught does not count. If it passes on any attempt or in any sample, the run ends as `control_survived` and exits 1, even for a rate with no plan. If the host broke, or the test threw for another reason such as a setup error, the run has no verdict. `agent-suites/reference/` holds one working example for each question type: discovery, clarity, cold start, teardown, and judges.

## Exit codes

The CLI exit code comes from one verdict, stored in the execution summary and read by the viewer.

| Exit | Verdict | Meaning |
| --- | --- | --- |
| 0 | `passed` | Every test that ran passed, on the first try, every sampling plan cleared or every `--repeat-each` repeat passed, and the runner agrees. |
| 0 | `listed` | `--list` only. No test ran. |
| 3 | `indicative` | Nothing failed, but the evidence cannot carry a pass. Either a rate has no plan to decide it (`samples` with no `flagAt`, or `--repeat-each` with `--measure`), or a run that would have passed recorded weak conditions: a host with no passing probe for its version and auth mode in the last week, an unpinned model, user configuration that may reach the run, or a host that only detects escapes. The CLI names each reason. |
| 1 | `agent_failed` | A check failed after the agent started, the host reported the agent's own terminal failure, the agent left its workspace, a repeat from `--repeat-each` failed, a sampling plan flagged, or a claim regressed from its baseline. A real failure outranks any test with no verdict. |
| 1 | `control_survived` | A control that must fail passed, so its test cannot tell good from bad. |
| 2 | `infra_invalid` | The host or runner failed, so nothing is known about the agent. |
| 2 | `conditions_unknown` | The run cannot show what a test asked about, a comparison's arms differ beyond its subject or one has no verdict, or a sampled run found a baseline file it cannot read. |
| 2 | `vacuous` | A test finished without earning its result: no agent operation completed, no check ran on what one produced, a run failed before its host started, for example on a missing workspace or skill or an exhausted snapshot budget, or a control failed for a reason other than a check. |
| 2 | `flaky` | A test failed and then passed on retry. Every attempt is kept. |
| 2 | `skipped_only` | No test ran. |
| 2 | `interrupted` | The run was stopped, a test it set out to run never started, for example under `--max-failures`, or an attempt never finished. |
| 2 | `author_error` | The test's own code failed, not a check and not an agent operation, so nothing is known about the agent. |
| 2 | `instrument_error` | The runner and the recorded attempts disagree, an agent or judge operation failed for a reason nobody typed, a failure has no recorded error, the samples of one test disagree on their plan, or a verdict reached exit 0 without the evidence its path needs. |

`--allow-indicative` makes an indicative run exit 0 for a caller that only wants the rates. The stored verdict keeps `indicative` and records `indicativeAllowed`, and the CLI says that exit 0 came from the flag. Runs stored before v5 named this verdict `measured`; the viewer reads them as indicative.

## Offline and live proof

Offline checks do not establish live provider reliability. Unit tests cover retained host capture/isolation and viewer behavior; SDK contracts use a fake adapter to prove resource ownership, parallel tasks, continuation, selected judge input, schema validation, rejection of a run that leaves its workspace, and rejection of a test that did not earn its result. Fake hosts prove that empty, garbage, truncated, killed, and unauthenticated runs are never recorded as completed, and `packages/test/fixtures/instrument` drives a scripted host through the real runner to fix the verdict and exit code of each outcome. They do not prove what a real host emits.

Offline tests prove the harness builds the right host arguments and rejects escapes. Only a live run proves the host enforces them. The escape battery (`bun run test:probe`) is that live gate for each way out of the seal, and a pass needs its enforced vectors held within the last week; see [hosts](hosts.md). Each vector also runs offline in the control gate, where a scripted host that holds it must pass and one that lets it through must fail on that vector's check. The capability suite's escape probe is a second live check: a canary in the checkout must never reach the agent's transcript or tool results, whether the agent refuses or tries. Run it after changing host isolation or upgrading a host CLI.

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
bun run test:nightly
```

`test:controls` runs the live subject controls in `agent-suites/reference`. `test:controls:offline` runs the scripted control gate that CI also runs. `test:nightly` is the nightly live proof: API-key hosts under `--verdict-grade`, the probe and escape battery, then the live controls. The `nightly live proof` workflow runs it on a schedule when the `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` secrets are set. It calibrates first, reports the battery's findings apart, uploads the logs and calibration, and opens an issue when an enforced vector or a control fails. It never gates a merge, because live provider state is too noisy to block on.

`bun run test:mutation` is the mutation audit of the verdict code (`verdict.ts`, `claims.ts`, `claim-strength.ts`), run nightly by the same workflow without a provider. Stryker changes the code one mutant at a time and runs the verdict, decision, property, claims and baseline unit tests. A mutant that survives is a change to how a run is judged that no test notices. The audit reports a score and does not fail on it; it was 91.0% when it was added, against a target of at least 90%. The surviving mutants on an exit-0 branch were triaged then. The ones left are equivalent in context: a caller decides the case first, or `flagAt` is always the sample's. The exception is the `EXIT_ZERO_PATHS` backstop in `provenVerdict`, which the reducer cannot reach with missing evidence by construction, so its predicates are tested directly. The real-runner contracts are too slow to run per mutant, so the operation ledger is not mutated.

The reliability command repeats the eleven TypeScript capability tests twenty times on the default OpenAI agent, with no retries, and reports each test's rate with its interval. It passes `--measure` to set no threshold, because requiring every repetition to pass would wrongly fail a 95% behavior 64% of the time. So the run is `indicative` and exits 3. To decide on a rate, use a [sampling plan](sdk-v2.md#rates-and-comparisons). The separately configured reviewer also needs authentication.

Missing usage never becomes zero or a partial average. Agent and judge usage are reported separately. Token differences across providers do not imply equivalent cost. An interval assumes independent runs, and same-day provider state can correlate them, so it can be optimistic; spread a qualifying run across days when that matters. A rate does not carry over to other prompts, tasks, or models.

The strict Biome policy is a required gate across the repository, including retained host and viewer code. Run `bun run lint` to check for zero errors and warnings. Passing runtime tests does not replace lint validation.
