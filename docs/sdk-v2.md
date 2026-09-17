# Agent Test SDK

<!-- source-of-truth: TypeScript agent-test API, configured agents, comparisons, and explicit judging. -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->

## Configure an agent

```ts
import { openai, claude, cursor } from "@post-print/agent-harness";

const coder = openai({
  model: "your-supported-model",
  auth: { type: "subscription" },
  skills: ["./skills/typescript"],
  context: {
    instructions: ["Follow existing project conventions."],
    files: ["./context/architecture.md"],
  },
  includeGlobalSkills: false,
});

const other = cursor({
  auth: { type: "api-key", env: "CURSOR_API_KEY" },
});
```

`openai()` runs the Codex coding agent. Factories do not contact providers or read credentials. Omitted authentication means subscription; omitted model uses the underlying host default. API keys are resolved in the session worker, with no fallback to another billing mode.

Skill directories contain `SKILL.md`. They are copied into the isolated host's project skill directory. Availability does not prove use. Context instructions and file contents are explicitly supplied as starting context and recorded in run artifacts. Relative source paths are resolved against the config directory. Project skills remain available; global skills are excluded unless explicitly enabled.

## Configure and execute tests

```ts
import { defineConfig } from "@post-print/agent-test";
import { openai } from "@post-print/agent-harness";

export default defineConfig({
  testDir: "./agent-tests",
  retries: 0,
  workers: 1,
  timeout: 180_000,
  use: { agent: openai(), workspace: "./fixtures/project" },
});
```

```sh
agent-test test --list
agent-test test
agent-test viewer --config agent-test.config.ts --port 0
```

Playwright handles test selection, hooks, projects, timeouts, and reports. The `agent` configuration becomes a fresh fixture; it is not a shared running client. Workspace paths name folders relative to the config directory. The default `.` uses a committed HEAD snapshot. Fixtures stay alive through assertions. SDK snapshots exclude `.git` and `node_modules` and reject symlinks rather than following them outside the workspace.

## Assertions and conversations

```ts
import { test, expect } from "@post-print/agent-test";

test("investigates and fixes", async ({ agent, workspace }) => {
  const diagnosis = await agent.run("Investigate the bug. Do not edit files.");
  expect(diagnosis.workspace.changedPaths).toEqual([]);
  const fix = await agent.run("Apply the fix and run npm test.");
  expect(fix).toHaveExecutedCommand({ command: "npm test", exitCode: 0 });
  expect(fix).toHaveModifiedPath("src/example.ts");
  expect(await workspace.readFile("src/example.ts")).toContain("expected text");
});
```

String command/tool matchers are exact; use a regular expression for partial matching. `toHaveAccessedPath` reports attempted access. `toHaveReadPath` requires structured successful-read evidence; it does not equate a mentioned path with read contents. Tool observations and exit codes require adapter capabilities, including for negative assertions.

Built-ins currently reconstruct conversation history rather than resuming native sessions. Each run records this capability. A single session rejects overlapping runs. Use comparison variants for separate runs.

## What judging means

An agent definition chooses **who evaluates**. Criteria choose **what to evaluate**. Assertions choose **which results pass**.

```ts
import { defineJudge } from "@post-print/agent-test";
import { openai } from "@post-print/agent-harness";

const reviewer = openai({
  skills: ["./skills/code-review"],
  context: { instructions: ["Ground conclusions in the supplied evidence."] },
});

const correctness = defineJudge({
  agent: reviewer,
  criteria: {
    correctness: {
      description: "Does the patch fix the bug without regressions?",
      scores: {
        0: "Incorrect or introduces a regression.",
        1: "Partially correct; important cases still fail.",
        2: "Correct, including boundary cases.",
      },
    },
  },
  context: { reference: { files: ["./evaluation/acceptance.md"] } },
});

// Inside a test:
const grade = await run.judge(correctness);
expect(grade.scores.correctness).toBe(2);
```

There is no global numeric `scale`. Each criterion has at least two declared numeric scores, higher meaning better. Only those exact scores are valid. A grade includes criterion-keyed `scores`, `reasons`, and `evidence`, plus separate judge usage and an artifact directory. An invalid response is a judge error, not a low score. A low score fails only when an assertion rejects it.

The judge receives the original task, observable conversation and tool activity, a changed-file list, initial/final file indexes, and recorded artifacts. Captured workspace files are available on demand under `initial/` and `final/`. Reference material goes only to the judge. Attached reviewer skills/instructions configure the reviewer; they do not alter the coding agent.

Judge requests and responses are saved. Oversized prompt evidence fails explicitly above 200000 bytes; it is not silently truncated. There is no automatic judge retry. Hidden reasoning and unavailable host internals cannot be supplied. Each judge invocation uses a fresh session. The OpenAI adapter uses a read-only sandbox; Claude limits its tool set to Read/Glob/Grep. Cursor currently rejects judging because an enforced read-only capability is not implemented. Custom adapters must declare and honor `readOnly`.

Variant names and model identities are not included in evaluation metadata, although transcript content may reveal identity. Metrics are omitted unless `context.includeMetrics` is true. This is best-effort blinding. Judge output evidence references are checked against the supplied file/transcript/reference indexes.

## Compare variants and tokens

```ts
const comparison = await compare({
  prompt: "Fix the bug and run npm test.",
  variants: {
    baseline: { agent: openai(), repeat: 3 },
    candidate: { agent: coder, repeat: 3 },
  },
});

const grade = await comparison.judge(correctness);
for (const run of grade.variants.candidate.runs) {
  expect(run.scores.correctness).toBe(2);
}
expect(comparison.variants.candidate.metrics.tokens.total.mean)
  .toBeLessThan(comparison.variants.baseline.metrics.tokens.total.mean);
```

Variants execute sequentially, round-robin across repetitions. Each repetition starts fresh. `comparison.runs` contains every run; `comparison.variants[name].runs` is variant-specific. `variant.metrics` provides count/mean/min/max for tokens, tool calls, and duration. Incomplete metrics expose `available: false`; accessing their numeric aggregates throws. Agent usage excludes judges. Cross-provider tokens are not equivalent cost, and a few repetitions are not statistical qualification.

Each run is graded independently in a fresh judge session. Variant scores are criterion-wise means. `grade.winner` is calculated from equally weighted normalized criterion scores; ties and single-variant grades return `null`. A winner does not imply acceptable correctness.

## Expected failed controls

```ts
await compare({
  prompt: "Find the current due date.",
  variants: {
    control: { agent: baseline, expectedFailures: ["current-date"] },
    candidate: { agent: candidate },
  },
  checks: async (run, check) => {
    await check("current-date", () => expect(run.output).toContain("2026-09-24"));
  },
});
```

Only named assertion failures may be expected. Expected checks must execute and fail. Unexpected passes fail the comparison. Runtime, unavailable-evidence, judge, and arbitrary callback errors remain fatal. Use ordinary `expect`, not `expect.soft`, inside collected checks.

## Custom adapters

```ts
import { defineAgent } from "@post-print/agent-harness";

export default defineAgent<{ model: string }>({
  name: "my-agent",
  capabilities: {
    conversation: "native",
    toolCalls: false,
    tokenUsage: false,
    readOnly: false,
  },
  async createSession({ options, workspace, signal, readOnly }) {
    const client = await createMyClient(options, workspace.path, signal);
    return {
      async *run(prompt) {
        yield { type: "text", text: await client.answer(prompt) };
      },
      async close() { await client.close(); },
    };
  },
});
```

`createMyClient` is consumer code. The adapter's event stream may emit text, structured tools, per-run usage, or a complete normalized trace. Usage events replace the current run's usage, so adapters must normalize incremental provider counters themselves. Implement declared capabilities faithfully. `readOnly` must be enforced, not merely requested in a prompt.

Load this module using `customAgent({ adapter: import.meta.resolve("./my-agent.js"), options: { model: "..." } })`. Use a JavaScript module or compile TypeScript before loading it in the isolated Node worker. Each session owns a worker process; cancellation terminates its process group on POSIX systems.

## Migration

TypeScript suites are the only execution path. JSON suites, `runAgentTest`, automatic judges, classifier adapters, and scenario scoring flags have been removed. Use Playwright selection, fixtures, retries, and reporters; use explicit `expect` calls and judge definitions for acceptance.

The public harness surface is configured agent definitions, sessions, and the trace/workspace utilities used by agent-test. The old adapter registry, `runAgent`, prompt-profile loader, automatic user simulator, and classifier APIs are removed. Built-in host execution and trace capture remain.

`allowUserSkills` has been renamed to `includeGlobalSkills`. It defaults to false for built-in and custom definitions. Opt in explicitly on the agent definition.

The viewer retains its display model and rendering tests for captured result evidence. This does not provide a second suite runner. Use Playwright's HTML reporter for portable reports: `agent-test test --reporter=html`.
