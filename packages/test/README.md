# @post-print/agent-test

<!-- source-of-truth: TypeScript agent fixtures, comparisons, and judge assertions -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=packages/test/src/*.ts,packages/test/src/**/*.ts,packages/test/package.json -->

Write executable tests for coding agents with familiar fixtures and assertions. Agent definitions come from `@post-print/agent-harness`; Playwright Test provides discovery, scheduling, and test lifecycle.

## First test

```ts
import { test, expect } from "@post-print/agent-test";
import { openai } from "@post-print/agent-harness";

const coder = openai({
  auth: { type: "subscription" },
  includeGlobalSkills: false,
  skills: ["./skills/testing"],
  context: { instructions: ["Run the relevant tests after making changes."] },
});

test.use({ agent: coder, workspace: "./fixtures/project" });

test("repairs the bug", async ({ agent }) => {
  const run = await agent.run("Fix the bug and run npm test.");
  expect(run).toHaveExecutedCommand({ command: "npm test", exitCode: 0 });
});
```

Create `agent-test.config.ts` with `defineConfig({ testDir: "./agent-tests" })`. Run `agent-test test --list` for discovery or `agent-test test` to execute. No browser is required. Live execution requires the configured host's authentication.

The full guide and reusable judge examples are in [the SDK guide](../../docs/sdk-v2.md). The executable tour is [tour.spec.ts](../../agent-suites/tour/tour.spec.ts), with shared agents and rubric in [agents.ts](../../agent-suites/tour/agents.ts).

## Contracts

- Agent definitions contain configuration. A fixture owns each session and workspace.
- Successive `agent.run()` calls continue the conversation. Built-in adapters currently reconstruct prior conversation; custom adapters can declare native continuation.
- Each comparison repetition gets its own workspace and session.
- Assertions throw. Agent assertions inspect evidence once; they never rerun the agent.
- Judges are explicit, use a separate read-only session, and return scores, reasons, and evidence. Your assertions determine acceptance.
- Missing metric/evidence data fails clearly; it never becomes a successful negative assertion or zero usage.
- Retries default to zero. Discovery never starts an agent.

TypeScript is the only suite execution path. JSON suites and `runAgentTest` have been removed. Use Playwright reporters for portable reports. `includeGlobalSkills` replaces `allowUserSkills` and defaults to false for every agent definition.
