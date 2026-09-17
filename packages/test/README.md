# @post-print/agent-test

<!-- source-of-truth: named agent and judge factories for TypeScript tests -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-17 -->
<!-- review-deps: paths=packages/test/src/*.ts,packages/test/src/**/*.ts,packages/test/package.json -->

```ts
import { describe, expect, z } from "@post-print/agent-test";

const test = describe("project answers", ({ agent, judge }) => ({
  coder: agent({ skills: ["./skills/research"] }),
  accuracy: judge({
    prompt: "Assess the answer against the reference.",
    schema: z.object({ correct: z.boolean(), reason: z.string() }),
  }),
}));

test("answers correctly", async ({ coder, accuracy }) => {
  const run = await coder.run({ prompt: "Who owns the project?" });
  const evaluation = await accuracy.run({ input: { answer: run.output, reference: "Mina" } });
  expect(evaluation.output.correct).toBe(true);
});
```

Set default `agent`, `judge`, and `workspace` directly in `defineConfig`. Harness definitions select providers, models, and auth. Factories only declare resources; each test receives its own executable handles. Every run starts fresh; use `run.continue` for the same task. Compare with ordinary JavaScript and `expect`. Use `expect(actual, "Readable criterion")` to give a derived viewer criterion a concise label, or declare explicit test criteria when they should override derived assertions.

Judge input is explicitly selected JSON data. Output is schema-validated and typed. The runner records artifacts and usage, handles cancellation, and owns cleanup. Global skills default to false. No browser is required for CLI execution.

See [the SDK guide](../../docs/sdk-v2.md), [tour](../../agent-suites/tour/tour.spec.ts), and [getting started](../../docs/getting-started.md). The old `test.use`, `compare`, `defineJudge`, and run-owned judge API are removed.
