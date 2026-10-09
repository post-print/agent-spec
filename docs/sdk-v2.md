# Agent Test SDK

<!-- source-of-truth: named agent and judge resources, independent runs, and selected evaluation input -->
<!-- doc-meta: owner=eng | last-reviewed=2026-10-09 -->
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

The default repository config selects OpenAI once. Cross-host execution is explicit in `agent-test.matrix.config.ts`. A project repeats independent tests; it does not compare their results.

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

`describe` runs its synchronous callback during discovery and returns a scoped test function. The callback returns only named `agent()` and `judge()` resources. Each test receives its own handles under those names. Resource names and optional descriptions appear in the viewer. Descriptions are discovery metadata and are not sent to the host agent. Schema output types are preserved through the returned test function.

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

Here, `writeFile` comes from `node:fs/promises` and `join` from `node:path`. Inside a test, `coder.setup(fn).run({ prompt })` adds preparation for that derived handle. Setup callbacks receive the task workspace, not the source directory; failed preparation fails the run and test teardown removes its workspace.

## Explicit judge inputs

A judge factory defines its reviewer, prompt, and Zod v4 schema. `judge.run({ input })` supplies JSON data selected by the test. You may use the SDK's `z` export or import a compatible Zod v4 schema. Schemas must support conversion to JSON Schema; unsupported transforms fail explicitly.

There is no automatic transcript, workspace, tool, or token inclusion. Passing `run.output` supplies only text. To evaluate a patch, read the selected snapshot files yourself and pass their contents. A whole run object is not JSON input because it contains execution methods. Judge definitions may explicitly attach their own context and skills; those are also supplied.

Every evaluation starts a fresh read-only reviewer in an empty sealed workspace in the OS temp folder, containing only its attached resources. It is not inside the test output folder or the caller checkout, so run transcripts, snapshots, and the repository's AGENTS.md or CLAUDE.md are out of reach. A reviewer whose tool calls name a path outside that workspace fails with `WorkspaceEscapeError`. The request records the selected input, output schema, and starting context. Response/trace, parsed result, errors, usage, and artifact paths are retained. Inputs above the 200000-byte request limit fail without truncation. Undefined and non-finite input values fail rather than being silently dropped or coerced.

`evaluation.output` is parsed and schema-validated. Invalid JSON or a schema mismatch is an evaluation error, with no automatic retry. There is no built-in score rubric, evidence-citation validator, or winner calculation: request those fields in your schema and assert whatever the test requires. Schema validation proves structure, not factual accuracy.

OpenAI uses a read-only permission profile that also denies the temp folder and the caller checkout, and loads no project instructions; Claude restricts judge tools to Read/Glob/Grep under the same denials. See [the isolation boundary](isolation.md#isolation-boundary). Cursor rejects judge sessions until enforced read-only support exists. Custom adapters must declare and enforce read-only capability.

## Comparisons and metrics

Use `Promise.all` for independent concurrent tasks or ordinary awaits for sequential execution. Each test owns all its pending runs and evaluations. Teardown cancels pending work, waits for it to settle, and closes sessions/workspaces even when one sibling fails. JavaScript `Promise.all` alone does not cancel siblings.

Use normal assertions to compare outputs and to require that an intentionally incorrect control is incorrect. Runtime errors remain errors. There is no `compare`, variants runner, or expected-failure wrapper.

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

## Verify results in the test

Assert outcomes with checks the test runs itself. The agent's own commands are weak evidence.

- `runCommand(directory, argv, { timeoutMs })` runs one program with an argument list (no shell) and resolves `{ exitCode, stdout, stderr }`. A nonzero exit resolves; a timeout, abort, or missing program rejects. Run it on `run.workspace.final.path`, a disposable copy, to rerun tests after the agent finishes. Copy held-out checks into that copy first when the visible tests could be satisfied by special-casing them. The copy excludes `node_modules`, `.git`, and `.venv`; a suite that needs dependencies installs them in setup.
- `toHaveExecutedCommand({ command, exitCode })` matches unwrapped shell commands. With `exitCode`, a command counts only when it runs last, after `cd`, `&&`, or `;`. A command in a pipeline or before `||` does not own the recorded exit code: `bun test | tail` with failing tests no longer passes as exit 0.
- `toHaveReadPath` needs a successful read through a read tool or a content-printing command (`cat`, `head`, `tail`, `sed`, `awk`, `nl`, `grep`, `rg`, and similar).
- `toHaveAccessedPath` over-reports, for negative use. The exact path, an enclosing directory, a matching glob, and Grep or Glob without a `path` all count as possible access.
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

For a future Skeleton qualification run, replace each per-pair attachment with an awaited `reportProgress(info, { taskId: task.id, pair: index + 1, result: pairs.at(-1) })`. A non-blocking orchestrator can then follow the progress journal or the viewer execution endpoint. Keep the final cell JSON write unchanged so existing evidence generation retains its current contract.

## Custom agents

Use `defineAgent` and `customAgent` from agent-harness. The adapter supplies capabilities and creates a session with `run(prompt)` and `close()`. It emits text, tool, usage, or normalized trace events. Adapter code runs in an isolated Node worker. Supply compiled JavaScript modules; configuration sent to workers must be serializable. Test-layer setup callbacks and judge schemas remain in the test process.

## Migration

Replace `test.use` with direct config defaults and factory resources returned from `describe`. Replace string run arguments with `{ prompt }`. Successive independent runs no longer share a workspace: use `run.continue` explicitly. Replace `compare` with JavaScript and assertions. Replace `defineJudge`/`run.judge` with a named `judge({ prompt, schema })` resource and selected `input`.

Behavior changes in this release, all on by default: runs and judges that name paths outside their workspace fail with `WorkspaceEscapeError`; Codex runs use a permission profile instead of `--sandbox`; Claude runs pass sandbox and permission `--settings`; judges no longer work inside the test output folder; `toHaveExecutedCommand` with `exitCode` ignores commands whose exit code belongs to a pipeline or `||` chain; `toHaveAccessedPath` counts enclosing directories, globs, and unscoped searches.

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

The viewer lists all discovered tests in its persistent sidebar. Each test has a separate route with its description, pass criteria, project, source file, and declared resources. Resource metadata shows configured hosts, models, skills, MCP server names, and judge instructions; it excludes authentication and MCP credentials. Recorded operations show which declared resources actually ran.

The Current run, Test setup, and Run history tabs keep the selected view and execution in the URL, so reload and browser navigation preserve them. Each attempt opens with a verdict: its status, how many checks passed, agent totals for duration, tokens, tool calls, and changed files (with the median per run when the test made several agent runs), and its checks. Failed and unrecorded checks always show with expected-versus-received detail; when there are more than three checks, passing ones fold under a "passed checks" disclosure. A check shows a judge explanation only when the judge returned one for that field. The judge section comes before the agent section. It opens with the question the judge was asked, since that defines what each finding means. Findings follow. Each is named in the test's own words, using the judge input label (a `baselineCitesSource` field reads as "Baseline") when the field judges an answer or the field name otherwise; the pass or fail icon carries the verdict, and the row names the agent run that produced the judged answer, adds that agent's `description` when the test gives one, and quotes the answer; short reference values the test supplied appear as "Compared with", and a single `reason` covering every field is shown once after the findings rather than split across them. Agent sections hold the conversation, and a per-run metrics card appears only when there are several runs to compare. In the judge section, the fields the test sent to the judge are folded under "What the judge saw", which opens on its own while the judge runs or when a finding failed. Selecting a run that contains multiple tests shows only the selected test's attempts and a link back to that run. Current run opens the newest run that executed the test, not one that skipped it, and Run history shows the test's own result in each run rather than the batch result.
