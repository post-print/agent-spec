# Getting started

<!-- source-of-truth: first consumer run of agent-test -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->

Write TypeScript tests with agent fixtures and ordinary assertions. The CLI uses Playwright Test without requiring a browser.

## Install and authenticate

```sh
npm install -D @post-print/agent-test @post-print/agent-harness
```

Use Node 22 or later. Authenticate the host you select; see [hosts.md](hosts.md). Authentication defaults to subscription. The CLI does not load `.env`.

## Configure an agent

Create `agent-test.config.ts`:

```ts
import { defineConfig } from "@post-print/agent-test";
import { openai } from "@post-print/agent-harness";

export default defineConfig({
  testDir: "./agent-tests",
  use: {
    agent: openai({ includeGlobalSkills: false }),
    workspace: "./fixtures/project",
  },
});
```

The fixture folder becomes a separate workspace for each test. `openai()` runs the Codex coding agent. Use `claude()` or `cursor()` to select another host. Set model, authentication, skills, and context on that definition.

## Write and run a test

Create `agent-tests/basic.spec.ts`:

```ts
import { test, expect } from "@post-print/agent-test";

test("runs the project tests", async ({ agent }) => {
  const run = await agent.run("Run npm test.");
  expect(run).toHaveExecutedCommand({ command: "npm test", exitCode: 0 });
});
```

```sh
npx agent-test test --list
npx agent-test test
npx agent-test viewer
```

Discovery does not launch agents. Execution uses your configured host credentials. The viewer uses the same TypeScript catalog and runner as the CLI.

## Judges and comparisons

Read [sdk-v2.md](sdk-v2.md) for reusable judge definitions, explicit score descriptions, comparison variants, repetition, token assertions, and custom agents. Judges run separately and inspect captured evidence. Your assertions decide what passes.

The repository's [tour](../agent-suites/tour/tour.spec.ts) contains seven complete examples. Shared agents and rubrics are in [agents.ts](../agent-suites/tour/agents.ts). Run `bun run test:tour` after authenticating OpenAI Codex. Use `node packages/test/dist/cli.js test tour --project=claude` or `--project=cursor` for other test agents; the tour's reviewer remains explicitly configured as OpenAI.

JSON suites and their legacy scoring flags have been removed. Discover the TypeScript capability checks with `agent-test test test-sdk-capabilities --list`.
