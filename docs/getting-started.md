# Getting started

<!-- source-of-truth: first consumer run with named agent-test resources -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->

Install `@post-print/agent-test` and `@post-print/agent-harness` as dev dependencies. Use Node 22+. Authenticate the selected host as described in [hosts](hosts.md). The CLI does not load .env.

Create `agent-test.config.ts`:

```ts
import { defineConfig } from "@post-print/agent-test";
import { openai } from "@post-print/agent-harness";
export default defineConfig({
  testDir: "./agent-tests",
  agent: openai(),
  judge: openai(),
  workspace: "./fixtures/project",
});
```

Create `agent-tests/basic.spec.ts`:

```ts
import { describe, expect } from "@post-print/agent-test";
const test = describe("project checks", ({ agent }) => ({ coder: agent() }));

test("runs the project tests", async ({ coder }) => {
  const run = await coder.run({ prompt: "Run npm test." });
  expect(run).toHaveExecutedCommand({ command: "npm test", exitCode: 0 });
});
```

Run `npx agent-test test --list` to discover tests without starting agents. Run `npx agent-test test` to execute or `npx agent-test viewer` for the viewer. No browser is needed for CLI execution. Global skills default to excluded.

Read [the SDK guide](sdk-v2.md) for named judges, typed results, selected inputs, independent parallel tasks, continuation, and task resources. Start with the eight [worked examples](../agent-suites/tour/tour.spec.ts). The [SDK checks](../agent-suites/test-sdk-capabilities/capabilities.spec.ts) contain eleven more examples.

The repository's default config selects OpenAI. Run `bun run test:tour` after authentication. The separate `agent-test.matrix.config.ts` selects all three hosts; use `--config agent-test.matrix.config.ts --project=claude` when selecting one matrix host. The configured reviewer remains OpenAI.
