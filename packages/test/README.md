# @post-print/agent-test

<!-- source-of-truth: named agent and judge factories for TypeScript tests -->
<!-- doc-meta: owner=eng | last-reviewed=2026-10-09 -->
<!-- review-deps: paths=packages/test/src/*.ts,packages/test/src/**/*.ts,packages/test/package.json -->

```ts
import { describe, expect, z } from "@post-print/agent-test";

const test = describe("project answers", ({ agent, judge }) => ({
  coder: agent({ skills: ["./skills/research"] }),
  grounding: judge({
    prompt: "Does the answer explain where in the project the owner is recorded?",
    schema: z.object({ grounded: z.boolean(), reason: z.string() }),
  }),
}));

test("answers correctly", async ({ coder, grounding }) => {
  const run = await coder.run({ prompt: "Who owns the project, and where is that recorded?" });
  expect(run.output).toContain("Mina");
  const evaluation = await grounding.run({ input: { answer: run.output } });
  expect(evaluation.output.grounded).toBe(true);
});
```

Set default `agent`, `judge`, and `workspace` directly in `defineConfig`. Harness definitions select providers, models, and auth. Factories only declare resources; each test receives its own executable handles. Every run starts fresh; use `run.continue` for the same task. Compare with ordinary JavaScript and `expect`. Use `expect(actual, "Readable criterion")` to give a derived viewer criterion a concise label, or declare explicit test criteria when they should override derived assertions.

Use assertions for anything code can decide, `runCommand` to verify the final workspace yourself, and a judge only for semantic questions. Judge input is explicitly selected JSON data. Output is schema-validated and typed. The runner records artifacts and usage, handles cancellation, and owns cleanup. Built-in timeouts are recorded as terminal infrastructure failures, including the configured deadline and partial trace. A new recorded run also recovers dead-owner summaries without requiring viewer navigation. Global skills default to false. A run or judge that names a path outside its workspace fails with `WorkspaceEscapeError`; see [isolation](../../docs/isolation.md#isolation-boundary). No browser is required for CLI execution.

See [the SDK guide](../../docs/sdk-v2.md), [tour](../../agent-suites/tour/tour.spec.ts), and [getting started](../../docs/getting-started.md). The old `test.use`, `compare`, `defineJudge`, and run-owned judge API are removed.

Full-tree snapshots are test-scoped and removed at teardown. Results, transcripts, hashes, and bounded changed-file evidence remain. Configure snapshot/source evidence limits and generated-output exclusions with the environment contract in [storage retention](../../docs/isolation.md#storage-ownership-and-retention).
