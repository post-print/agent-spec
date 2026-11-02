# Agent Test SDK

<!-- source-of-truth: named agent and judge resources, independent runs, and selected evaluation input -->
<!-- doc-meta: owner=eng -->
<!-- review-deps: paths=packages/test/src/sdk/*.ts,agent-test*.config.ts,agent-suites/**/*.ts -->

## Configure defaults

```ts
import { defineConfig } from "@post-print/agent-test";
import { openai } from "@post-print/agent-harness";

export default defineConfig({
  agent: openai({ model: "your-coding-model" }),
  judge: openai({ model: "your-review-model" }),
  workspace: "./fixtures/project",
  retries: 0,
});
```

Definitions choose model, authentication, and reusable resources. They do not launch sessions. `openai()` runs Codex, `claude()` runs Claude Code, and `cursor()` runs the Cursor SDK. Authentication defaults to subscription; API-key auth names an environment variable with `{ type: "api-key", env: "OPENAI_API_KEY" }`. No billing fallback is performed.

The default repository config selects OpenAI once. Cross-host execution is explicit in `agent-test.matrix.config.ts`. A project repeats independent tests. Results from different hosts are not ranked against each other.

## Return named resources from describe

```ts
import { describe, expect, z } from "@post-print/agent-test";

const test = describe("task answers", ({ agent, judge }) => ({
  baseline: agent({ description: "Uses the suite's default agent configuration." }),
  researcher: agent({
    description: "Adds the research skill for current-information tasks.",
    skills: ["./skills/research"],
  }),
  sourcing: judge({
    prompt: "Does each answer name the authoritative source it used for the deadline?",
    schema: z.object({
      baselineCitesSource: z.boolean(),
      candidateCitesSource: z.boolean(),
      reason: z.string(),
    }),
  }),
}));

test("research preserves accuracy", async ({ baseline, researcher, sourcing }) => {
  const prompt = "Find the current deadline and name your source.";
  const [first, second] = await Promise.all([
    baseline.run({ prompt }),
    researcher.run({ prompt }),
  ]);
  // Code decides what code can decide; the judge grades only the semantic question.
  expect(first.output).toContain("2026-09-24");
  expect(second.output).toContain("2026-09-24");
  const evaluation = await sourcing.run({
    input: { baseline: first.output, candidate: second.output },
  });
  expect(evaluation.output.baselineCitesSource).toBe(true);
  expect(evaluation.output.candidateCitesSource).toBe(true);
});
```

`describe` runs its synchronous callback during discovery and returns a scoped test function. The callback returns only named `agent()` and `judge()` resources. Each test receives its own handles under those names. Resource names and optional descriptions appear in the viewer. Descriptions are discovery metadata and are not sent to the host agent. Schema output types are preserved through the returned test function. Pass `describe(name, { description }, define)` to state what the whole suite proves; the viewer shows it once above the suite's tests instead of repeating it on each one.

Factories inherit the config's corresponding agent or judge definition. Set `agent: claude(...)` on a factory to override that definition. A judge without a configured or explicit reviewer fails clearly; it never borrows the coding agent implicitly.

The scoped test function currently registers a title, an optional description, and an async body. It is not the full Playwright `TestType` and does not expose `test.use`, `extend`, or hook methods. Use `agent().setup(fn)` for workspace preparation. Playwright still owns test selection, projects, retries, timeouts, scheduling, and reports.

## Independent tasks and explicit continuation

Every `agent.run({ prompt, ... })` creates an independent workspace and host session. Concurrent calls are supported, including calls on the same named handle. Resources live until the enclosing test ends so task continuation remains available.

```ts
const diagnosis = await coder.run({ prompt: "Investigate without editing." });
const repair = await diagnosis.continue({ prompt: "Apply the fix and run the tests." });
```

Continuation keeps the original resources and workspace. Overlapping continuations of the same conversation are rejected. Built-in hosts do not resume native sessions: each continuation replays the earlier user and assistant text (not tool calls or results) ahead of the new prompt, and reports `capabilities.conversation: "reconstructed"`. A continuation that repeats an earlier message therefore proves the replay, not model memory. Custom adapters may declare native continuation.

Run results expose `output`, `trace`, `conversation`, `toolCalls`, `usage`, `durationMs`, `startingContext`, workspace snapshots/changed paths, and an artifact directory. `continue` is the only execution method on a run result. Snapshot file contents remain available until test teardown. Teardown removes full-tree copies while preserving hash maps and bounded changed-file evidence. See [storage ownership and retention](isolation.md#storage-ownership-and-retention) for budgets, exclusion settings, and recovery boundaries.

A tool call that returns images, such as a Claude `Read` of a PNG or an MCP screenshot, keeps a short marker like `[image: image/png, 48 KB]` in `toolCalls[n].result`. The images themselves are in `toolCalls[n].images` as `{ mediaType, bytes, data? }`. `data` is base64 and is kept for up to four images per call of at most 256 KB each; a larger image keeps only its type and size. Assertions and judges therefore never receive raw base64 through `result`, and the viewer shows stored images as thumbnails.

## Task resources

Factory settings and run options can supply `skills`, `context`, `mcpServers`, `workspace`, and `timeoutMs`. Model/authentication can be set on the factory or harness definition. `includeGlobalSkills` defaults to false. Built-in hosts default each run to a ten-minute deadline; a timeout is recorded as an infrastructure failure while preserving streamed trace evidence.

```ts
const run = await coder.run({
  prompt: "Find the current task deadline.",
  skills: ["./skills/task-research"],
  context: { instructions: ["Cite the authoritative source."], files: ["./context/brief.md"] },
  mcpServers: { taskRecords: taskRecordsMcp },
});
```

Skill and context-file lists are additive, with duplicate identical paths removed. Instructions append in definition, factory, run order. MCP servers merge by name; later settings replace a server with the same name. Different skill sources targeting the same directory are rejected. Context files are inlined into the text prompt, so each must be UTF-8 text; a binary file such as an image fails the run with a message to place it in the workspace instead. Skill paths name directories containing SKILL.md and resolve against the config directory. A skill's availability does not prove its use.

`workspace` chooses the source folder for each task. `.setup(fn)` returns a new agent resource or test handle. Chained callbacks run in declaration order after copying the workspace and before recording its initial snapshot or starting the host. They run for every independent `.run()`; `.continue()` reuses the prepared workspace. The original agent is unchanged. Run additions do not affect later independent runs or judges.

```ts
const test = describe("seeded tasks", ({ agent }) => ({
  coder: agent().setup(async (workspace) => {
    await writeFile(join(workspace.path, "seed.txt"), "ready", "utf8");
  }),
}));
```

Here, `writeFile` comes from `node:fs/promises` and `join` from `node:path`. Inside a test, `coder.setup(fn).run({ prompt })` adds preparation for that derived handle. Setup callbacks receive the task workspace, not the source directory; failed preparation fails the run and test teardown removes its workspace. Setup runs outside the host sandbox, so it is where a test installs dependencies or writes config the agent cannot. Agents start with network off; `networkAccess: true` on an `openai()` or `claude()` coding agent turns it on. See [what an agent can reach](isolation.md#what-an-agent-can-reach).

Set `observeEnvironment: { paths: ["node_modules"] }` on an agent or run to answer cold-start and teardown questions. `run.environment` then lists processes the run left alive in its workspace, the ports they listen on, and a file count and size for each named path, including paths snapshots exclude. `processesKnown` is false when `ps` or `lsof` could not run; reading `processes` or `listeningPorts` then throws `ConditionsUnknownError`, so the test has no verdict. A path that could not be inspected behaves the same way. On a continuation the lists cover everything started since the task began. The runtime stops observed survivors at teardown. `run.record` and `run.exposure` state the conditions of every run; see [what a run records](hosts.md#what-a-run-records).

## Explicit judge inputs

A judge factory defines its reviewer, prompt, and Zod v4 schema. `judge.run({ input })` supplies JSON data selected by the test. You may use the SDK's `z` export or import a compatible Zod v4 schema. Schemas must support conversion to JSON Schema; unsupported transforms fail explicitly. The host holds the reply to the schema where it can; see [hosts](hosts.md). On OpenAI, give every field a value, using `.nullable()` rather than `.optional()`, or the schema is sent only in the prompt. A judge that cannot give a verdict rejects `judge.run` with an `AgentInfrastructureError`: the code `host_exit`, `auth`, or `timeout` when the host crashed, could not log in, or ran out of time, and `judge_failed` for a turn the host reported as failed, a reply that still does not match, or a request that could not be prepared, such as an unsupported schema or an oversized input. A test that fails after that has no verdict, even if it handled the rejection: it is not counted as a failure of the agent, and the run exits 2. A test that handles the rejection and otherwise earns its result still passes. A judge with no configured agent fails as a setup error, so the test has no verdict.

There is no automatic transcript, workspace, tool, or token inclusion. Passing `run.output` supplies only text. To evaluate a patch, read the selected snapshot files yourself and pass their contents. A whole run object is not JSON input because it contains execution methods. Judge definitions may explicitly attach their own context and skills; those are also supplied.

Every evaluation starts a fresh read-only reviewer in an empty sealed workspace in the OS temp folder, containing only its attached resources. It is not inside the test output folder or the caller checkout, so run transcripts, snapshots, and the repository's AGENTS.md or CLAUDE.md are out of reach. A reviewer whose tool calls name a path outside that workspace fails with `WorkspaceEscapeError`. The request records the selected input, output schema, and starting context. Response/trace, parsed result, errors, usage, and artifact paths are retained. Inputs above the 200000-byte request limit fail without truncation. Undefined and non-finite input values fail rather than being silently dropped or coerced.

`evaluation.output` is parsed and schema-validated. Invalid JSON or a schema mismatch is an evaluation error, with no automatic retry. There is no built-in score rubric, evidence-citation validator, or winner calculation: request those fields in your schema and assert whatever the test requires. Schema validation proves structure, not factual accuracy.

OpenAI uses a read-only permission profile that also denies the temp folder and the caller checkout, and loads no project instructions; Claude restricts judge tools to Read/Glob/Grep under the same denials. See [the isolation boundary](isolation.md#isolation-boundary). Cursor rejects judge sessions until enforced read-only support exists. Custom adapters must declare and enforce read-only capability.

## Comparisons and metrics

Use `Promise.all` for independent concurrent tasks or ordinary awaits for sequential execution. Each test owns all its pending runs and evaluations. Teardown cancels pending work, waits for it to settle, and closes sessions/workspaces even when one sibling fails. JavaScript `Promise.all` alone does not cancel siblings.

A passing test body is not enough for a pass. The test also fails when:

- no agent or judge operation completed, unless the test declares `noAgent: true` because it checks only the runner;
- no check ran on what a completed operation produced. A check counts when agent-test's `expect` (also `expect.soft` and `expect.poll`) runs after the test read the run's `output`, `trace`, `conversation`, `toolCalls`, `workspace`, `environment` or `usage`, or an evaluation's `output`, or when the run itself is the value checked, as in `expect(run).toHaveCalledTool(...)`. The prompt, `record` and `exposure` are the test's own inputs and conditions, so checking only them does not count. An `expect` imported from `@playwright/test` is not seen;
- a run that was never awaited or handled failed or was still in progress when the body ended;
- it caught a `WorkspaceEscapeError` without using `expectWorkspaceEscape`.

```ts
import { expectWorkspaceEscape } from "@post-print/agent-test";

// The run must attempt the escape.
const { escaped } = await expectWorkspaceEscape(agent.run({ prompt }));

// The agent may refuse instead; any other error still fails the test.
const { escaped, run } = await expectWorkspaceEscape(agent.run({ prompt }), { allowRefusal: true });
```

Use normal assertions to compare outputs and to require that an intentionally incorrect control is incorrect; see [controls](reliability.md#controls). Runtime errors remain errors. To ask how often something happens or whether one subject beats another, see [rates and comparisons](#rates-and-comparisons).

```ts
import { statistics } from "@post-print/agent-test";

const measurements = await Promise.all([
  researcher.run({ prompt }),
  researcher.run({ prompt }),
]);
const tokens = statistics(measurements.map(run => run.usage.tokens.total));
expect(tokens.mean).toBeLessThan(tokenBudget);
```

`statistics` computes count/mean/min/max. Missing measurements expose `available: false` and throw when an aggregate is accessed. Judge usage is separate from task usage. Cross-provider tokens are not equivalent cost; small samples do not establish reliability.

## Rates and comparisons

One run says something can happen, not how often it does. `samples` runs a test n times and reports one claim: k of n, with an exact 95% interval.

```ts
test("how often an agent finds the tool", { description: "...", samples: 10 }, async ({ agent }) => {
  // Ordinary assertions. A failed sample counts against the rate.
});
```

With no threshold the verdict is `indicative` and exits 3: a rate with nothing required of it, so it cannot pass. To decide, compute a plan first, which fixes the sample size and the flag before any run. The run stops as soon as the decision can no longer change, which leaves the plan's error rates intact.

```ts
import { samplingPlan } from "@post-print/agent-test";

// { n: 27, flagAt: 4 }: tells 95% from 80%, with a 4.4% false alarm rate and 82% power.
test("finds the tool", { description: "...", samples: samplingPlan({ target: 0.95, detect: 0.8 }) }, body);
```

`variants` runs the same task for each of two named arms, in an order shuffled per execution, and the body receives the arm's name. A third arm is an error when the suite loads. The result gives both rates and their difference with an interval. `subject` declares what differs on purpose: `prompt`, `skills`, `workspace`, `tools`, or `model`. If the recorded conditions differ in anything else, including auth mode, setting sources, overriding environment, tools or other definition settings, or an arm has no verdict or was filtered out, the comparison is refused and the run has no verdict.

```ts
test("the wording matters", {
  description: "...",
  samples: 20,
  variants: ["clear", "misleading"],
  subject: "tools",
}, async (agents, _info, variant) => {
  await callsCorrectly(variant === "clear" ? agents.clear : agents.misleading);
});
```

A retried sample counts once, at its first verdict. Failures from the host or runner count as no verdict and stay out of the rate. They do not bring a plan's stop closer, and a plan clears only on enough passes: one left short of them has no verdict and exits 2, unless it regressed from its baseline. `--repeat-each` also reports per-test rates, but a failed repeat still fails the run and a repeat with no verdict exits 2, so a gate that uses repeats stays a gate. Add `--measure` to report the rates without judging them; the run is then `indicative`. A `--repeat-each` gate where every repeat passed is `passed`.

`agent-test baseline` saves the newest run's single-arm claims to `agent-test-baselines/`; commit them. It leaves out, and names, a claim with runs that have no verdict, a surviving control, or a model nothing names, because a later run could not be matched to it. It saves only claims that stood, `passed` or `indicative`, and nothing from a run whose verdict is anything else, so a failed, flagged or regressed claim cannot lower the bar. A later run under the same conditions is compared against the baseline and fails if it regressed. A changed host, model, auth mode, setting, tool, suite, prompt, skill, or workspace starts over rather than reading as a regression, and so does a model that neither the definition nor the host names. A baseline file that cannot be read gives a sampled run no verdict, so a regression cannot go unseen.

## Verify results in the test

Assert outcomes with checks the test runs itself. The agent's own commands are weak evidence.

- `runCommand(directory, argv, { timeoutMs })` runs one program with an argument list (no shell) and resolves `{ exitCode, stdout, stderr }`. A nonzero exit resolves; a timeout, abort, or missing program rejects. Run it on `run.workspace.final.path`, a disposable copy, to rerun tests after the agent finishes. Copy held-out checks into that copy first when the visible tests could be satisfied by special-casing them. The copy excludes `node_modules`, `.git`, and `.venv`; a suite that needs dependencies installs them in setup.
- `toHaveExecutedCommand({ command, exitCode })` matches unwrapped shell commands. A pattern must match from the start of a simple command, after any `NAME=value` assignments, so `/bun test/` matches `bun test` and `cd app && bun test`, but not `echo bun test` or `grep "bun test" README.md`. With `exitCode`, a command counts only when it runs last, after `cd`, `&&`, or `;`. A command in a pipeline or before `||` does not own the recorded exit code: `bun test | tail` with failing tests no longer passes as exit 0.
- `toHaveReadPath` needs a successful read through a read tool or a content-printing command (`cat`, `head`, `tail`, `sed`, `awk`, `nl`, `grep`, `rg`, and similar).
- `toHaveModifiedPath` accepts a folder, and gives no verdict for paths snapshots leave out.
- `toHaveAccessedPath` over-reports, for negative use. The exact path, an enclosing directory, a matching glob, and Grep or Glob without a `path` all count as possible access. Recursive shell searches (`grep -r`, `rg`) with no path count too.
- `toHaveUsedSkill` needs a skill load or skill-file read that the host reported as successful. A load whose outcome was not reported gives no verdict.
- A check that something did not happen, with `.not`, on a command, read, path access, skill, or a tool name that could be the shell, needs a host that reports every command it runs (`capabilities.commandEventsComplete`). Claude Code does. Codex and Cursor are not shown to, so the check throws `ConditionsUnknownError` there and the test has no verdict. Assert on what the work must leave in the workspace instead.
- Use a judge only for questions code cannot decide, such as whether an explanation is correct. Compare strings, file lists, and dates with assertions.

## Durable progress for long tests

Use `reportProgress` when one test performs several material steps and an external caller must observe each completed step before the test ends. Pass the current Playwright `TestInfo` so every update records the execution, test, and retry identity. Await each call; the promise resolves only after one complete, redacted JSON record has been appended.

```ts
import { reportProgress } from "@post-print/agent-test";

qualification("runs paired attempts", async ({ baseline, treatment }, info) => {
  const pairs = [];
  for (let index = 0; index < 10; index++) {
    const pair = await runPair(baseline, treatment);
    pairs.push(pair);
    await reportProgress(info, { pair: index + 1, result: pair });
  }
});
```

Recorded executions publish each update through an atomic rename under `.agent-test/executions/<execution-id>/progress/`. The execution detail returned by the local viewer API includes the ordered `progress` records while the test is running. Complete records survive cancellation or a process crash; readers ignore incomplete temporary or invalid records. Concurrent tests share the directory safely and remain distinguishable by `testId` and `attemptId`. Local filesystem paths use the same redaction policy as recorded agent events.

The viewer's test verdict shows the top-level numeric fields of an attempt's progress updates beside its run metrics; a later update replaces an earlier value with the same key. A key ending in `Ms` is shown as a duration. Files attached with `testInfo.attach(name, { path, contentType })` appear in the verdict as links that the viewer server serves from the recorded path.

For a future Skeleton qualification run, replace each per-pair attachment with an awaited `reportProgress(info, { taskId: task.id, pair: index + 1, result: pairs.at(-1) })`. A non-blocking orchestrator can then follow the progress journal or the viewer execution endpoint. Keep the final cell JSON write unchanged so existing evidence generation retains its current contract.

## Custom agents

Use `defineAgent` and `customAgent` from agent-harness. The adapter supplies capabilities and creates a session with `run(prompt)` and `close()`. It emits text, tool, usage, or normalized trace events. Adapter code runs in an isolated Node worker. Supply compiled JavaScript modules; configuration sent to workers must be serializable. Test-layer setup callbacks and judge schemas remain in the test process. An adapter whose host failed must throw `AgentInfrastructureError` with a code. An adapter whose agent failed on its own, for example by running out of turns, throws `AgentOutcomeError`, which is charged to the agent. A plain error is untyped whatever its message says: the test has no verdict, and the agent is not blamed.

## Migration

Replace `test.use` with direct config defaults and factory resources returned from `describe`. Replace string run arguments with `{ prompt }`. Successive independent runs no longer share a workspace: use `run.continue` explicitly. Replace `compare` with JavaScript and assertions. Replace `defineJudge`/`run.judge` with a named `judge({ prompt, schema })` resource and selected `input`.

Behavior changes in this release, all on by default: runs and judges that name paths outside their workspace fail with `WorkspaceEscapeError`; Codex runs use a permission profile instead of `--sandbox`; Claude runs pass sandbox and permission `--settings`; judges no longer work inside the test output folder; `toHaveExecutedCommand` with `exitCode` gives no verdict when the only matching commands ran in a pipeline or `||` chain; `toHaveAccessedPath` counts enclosing directories, globs, and unscoped searches.

JSON suites and their separate runtime remain removed. Playwright HTML reporting is available through `agent-test test --reporter=html`. No compatibility execution path is retained for the earlier SDK shape.

## Test pages in the viewer

Tests may supply a description, the named resources they use, and explicit pass criteria for discovery and the viewer. Resource names are checked against the surrounding `describe` definition. Omit `resources` to expose every suite resource for compatibility.

When `criteria` is omitted, agent-test derives the viewer's pass criteria from direct `expect(...)` calls in the test callback, in declaration order. Pass a static message as Playwright's optional second `expect` argument to give the criterion a readable label: `expect(run.output, "The response names Mina.").toContain("Mina")`. Without a static message, the viewer displays the normalized assertion expression. Execution semantics do not change, and explicit `criteria` remain authoritative. Assertions hidden behind a helper cannot be discovered from the callback, so use explicit criteria when the setup view needs to describe those checks.

```ts
test("reads the project owner", {
  description: "Read PROJECT.md and name its owner. Check that the agent actually read the file.",
  resources: ["coder"],
  criteria: ["The response names the owner.", "PROJECT.md is read."],
}, async ({ coder }) => {
  const run = await coder.run({ prompt: "Who owns the project? Read PROJECT.md." });
  expect(run).toHaveReadPath("PROJECT.md");
});
```

Name a test after its scenario and the behaviour it expects, and use its `description` for the one thing this case adds; leave shared context to the suite description. When every test in a group repeats the same description, the viewer treats it as the suite's and shows it once. The test header shows the suite description, the test's own description, and its pass checks folded under "Passes when".

The viewer lists all discovered tests in its persistent sidebar. Each test has a separate route with its description, pass criteria, project, source file, and declared resources. Resource metadata shows configured hosts, models, skills, MCP server names, and judge instructions; it excludes authentication and MCP credentials. Recorded operations show which declared resources actually ran.

The Current run, Test setup, and Run history tabs keep the selected view and execution in the URL, so reload and browser navigation preserve them. Each attempt opens with a verdict: its status, how many checks passed, agent totals for duration, tokens, tool calls, and changed files (with the median per run when the test made several agent runs), any numeric values the test reported with `reportProgress`, its checks, and links to files the test attached. Failed and unrecorded checks always show with expected-versus-received detail; when there are more than three checks, passing ones fold under a "passed checks" disclosure. A check shows a judge explanation only when the judge returned one for that field. The judge section comes before the agent section. It opens with the question the judge was asked, since that defines what each finding means. Findings follow. Each is named in the test's own words, using the judge input label (a `baselineCitesSource` field reads as "Baseline") when the field judges an answer or the field name otherwise; the pass or fail icon carries the verdict, and the row names the agent run that produced the judged answer, adds that agent's `description` when the test gives one, and quotes the answer; short reference values the test supplied appear as "Compared with", and a single `reason` covering every field is shown once after the findings rather than split across them. Agent sections hold the conversation, and a per-run metrics card appears only when there are several runs to compare. In the judge section, the fields the test sent to the judge are folded under "What the judge saw", which opens on its own only when a finding failed. Short values read inline; larger fields fold behind their size (for example "38 items"), string lists render as lists, tool-call lists render like the transcript, and every expanded field has a capped height. While a test runs, a live status strip stays pinned above its verdict with the elapsed time, the step count, what the agent or judge is doing now, and the latest `reportProgress` entry. The run inbox shows how long a live run has gone and how many of its tests finished. Selecting a run that contains multiple tests shows only the selected test's attempts and a link back to that run. Current run opens the newest run that executed the test, not one that skipped it, and Run history shows the test's own result in each run rather than the batch result.
