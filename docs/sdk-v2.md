# Agent Test SDK

<!-- source-of-truth: named agent and judge resources, independent runs, and selected evaluation input -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
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
  baseline: agent(),
  researcher: agent({ skills: ["./skills/research"] }),
  accuracy: judge({
    prompt: "Compare each answer against the supplied reference.",
    schema: z.object({
      baselineCorrect: z.boolean(),
      candidateCorrect: z.boolean(),
      reason: z.string(),
    }),
  }),
}));

test("research preserves accuracy", async ({ baseline, researcher, accuracy }) => {
  const prompt = "Find the current deadline.";
  const [first, second] = await Promise.all([
    baseline.run({ prompt }),
    researcher.run({ prompt }),
  ]);
  const evaluation = await accuracy.run({
    input: {
      baseline: first.output,
      candidate: second.output,
      reference: "2026-09-24",
    },
  });
  expect(evaluation.output.baselineCorrect).toBe(true);
  expect(evaluation.output.candidateCorrect).toBe(true);
});
```

`describe` runs its synchronous callback during discovery and returns a scoped test function. The callback returns only named `agent()` and `judge()` resources. Each test receives its own handles under those names. Resource names appear in the viewer. Schema output types are preserved through the returned test function.

Factories inherit the config's corresponding agent or judge definition. Set `agent: claude(...)` on a factory to override that definition. A judge without a configured or explicit reviewer fails clearly; it never borrows the coding agent implicitly.

The scoped test function currently registers a title and async body. It is not the full Playwright `TestType` and does not expose `test.use`, `extend`, or hook methods. Use `agent().setup(fn)` for workspace preparation. Playwright still owns test selection, projects, retries, timeouts, scheduling, and reports.

## Independent tasks and explicit continuation

Every `agent.run({ prompt, ... })` creates an independent workspace and host session. Concurrent calls are supported, including calls on the same named handle. Resources live until the enclosing test ends so task continuation remains available.

```ts
const diagnosis = await coder.run({ prompt: "Investigate without editing." });
const repair = await diagnosis.continue({ prompt: "Apply the fix and run the tests." });
```

Continuation keeps the original resources and workspace. Overlapping continuations of the same conversation are rejected. Built-in hosts reconstruct history rather than resume native sessions; custom adapters may declare native continuation.

Run results expose `output`, `trace`, `conversation`, `toolCalls`, `usage`, `durationMs`, `startingContext`, workspace snapshots/changed paths, and an artifact directory. `continue` is the only execution method on a run result.

## Task resources

Factory settings and run options can supply `skills`, `context`, `mcpServers`, `workspace`. Model/authentication can be set on the factory or harness definition. `includeGlobalSkills` defaults to false.

```ts
const run = await coder.run({
  prompt: "Find the current task deadline.",
  skills: ["./skills/task-research"],
  context: { instructions: ["Cite the authoritative source."], files: ["./context/brief.md"] },
  mcpServers: { tasks: taskService },
});
```

Skill and context-file lists are additive, with duplicate identical paths removed. Instructions append in definition, factory, run order. MCP servers merge by name; later settings replace a server with the same name. Different skill sources targeting the same directory are rejected. Skill paths name directories containing SKILL.md and resolve against the config directory. A skill's availability does not prove its use.

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

Every evaluation starts a fresh read-only reviewer in a separate workspace containing only its attached resources. The request records the selected input, output schema, and starting context. Response/trace, parsed result, errors, usage, and artifact paths are retained. Inputs above the 200000-byte request limit fail without truncation. Undefined and non-finite input values fail rather than being silently dropped or coerced.

`evaluation.output` is parsed and schema-validated. Invalid JSON or a schema mismatch is an evaluation error, with no automatic retry. There is no built-in score rubric, evidence-citation validator, or winner calculation: request those fields in your schema and assert whatever the test requires. Schema validation proves structure, not factual accuracy.

OpenAI uses a read-only sandbox; Claude restricts judge tools to Read/Glob/Grep. Cursor rejects judge sessions until enforced read-only support exists. Custom adapters must declare and enforce read-only capability.

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

## Custom agents

Use `defineAgent` and `customAgent` from agent-harness. The adapter supplies capabilities and creates a session with `run(prompt)` and `close()`. It emits text, tool, usage, or normalized trace events. Adapter code runs in an isolated Node worker. Supply compiled JavaScript modules; configuration sent to workers must be serializable. Test-layer setup callbacks and judge schemas remain in the test process.

## Migration

Replace `test.use` with direct config defaults and factory resources returned from `describe`. Replace string run arguments with `{ prompt }`. Successive independent runs no longer share a workspace: use `run.continue` explicitly. Replace `compare` with JavaScript and assertions. Replace `defineJudge`/`run.judge` with a named `judge({ prompt, schema })` resource and selected `input`.

JSON suites and their separate runtime remain removed. Playwright HTML reporting is available through `agent-test test --reporter=html`. No compatibility execution path is retained for the earlier SDK shape.
