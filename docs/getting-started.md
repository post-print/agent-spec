# Getting started

<!-- source-of-truth: first consumer run of agent-test -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-15 -->

<!-- review-deps: paths=.env.example,package.json,packages/test/package.json,packages/test/src/validate-suite.ts,packages/test/src/types.ts -->

Install `@post-print/agent-test`. Write one JSON suite. Check it. Then launch a host agent.

A **host** is Cursor, Claude Code, or OpenAI Codex. A **suite** is a folder of scenarios under `agent-suites/`. JSON is an authoring adapter. The runner always launches a real agent.

This paper is the first consumer hour. CLI flags live in [cli.md](cli.md). Suite fields live in [suites.md](suites.md). Auth lives in [hosts.md](hosts.md).

## Prerequisites

- Node ≥ 22
- A host you can authenticate. See [hosts.md](hosts.md).
- The CLI does not load `.env`. Export variables in the shell.

## 1. Install

```bash
npm install -D @post-print/agent-test
```

The package is native ESM. Bun is not required at runtime. This repo uses Bun only to develop the packages.

## 2. Write a suite

Create `agent-suites/confidence/scenarios.json`:

```json
{
  "name": "confidence",
  "hosts": ["cursor"],
  "defaults": {
    "host": "cursor",
    "allowUserSkills": false
  },
  "scenarios": [
    {
      "name": "returns exact text",
      "workspace": "agent-suites/fixtures/task-list",
      "prompt": "Reply with exactly: CONFIDENCE_OK",
      "rubric": {
        "must": ["CONFIDENCE_OK"],
        "mustNotCallTool": ["Shell", "Bash"]
      }
    }
  ]
}
```

Create the workspace folder. The runner copies that folder into a sealed temp repo.

## 3. Check without a live run

```bash
npx agent-test --check --suites-dir agent-suites --suite confidence
```

`--check` inspects the suite, seeds, package, and host. It does not launch an agent. A missing host key does not fail this command.

If the check fails, fix the printed path or host message. Then run the same command again.

## 4. Export host auth

Copy `.env.example` if you work in this repo. Export the variables. Do not expect the CLI to read the file.

Default auth is subscription. Run `npx agent-test login` first. The Cursor app login does not count.

To bill an API key:

```bash
export CURSOR_API_KEY=…
```

Then pass `--auth-mode api-key` on the live command.

Claude and OpenAI steps live in [hosts.md](hosts.md).

## 5. Launch the host

```bash
npx agent-test --suites-dir agent-suites --suite confidence --host cursor --fail-on=behavior
```

A TTY run prints an `agent` clock and a localhost HTML report link. `--fail-on=behavior` ignores judge and host infrastructure flakes. The CLI default is `--fail-on=all`. In-repo scripts use `behavior`. Categories live in [reliability.md](reliability.md).

## TypeScript API

JSON is optional. Call `runAgentTest` in the same process:

```ts
import { runAgentTest } from "@post-print/agent-test";

const result = await runAgentTest({
  cwd: process.cwd(),
  scenario: {
    name: "uses the project instructions",
    contextMode: "host-native",
    prompt: "Review the current change.",
    rubric: { reviewDepth: "standard" },
  },
});
```

The default host is Cursor. `host-native` sends the prompt unchanged and lets the selected host discover its supported project context. Use `harness-preamble` when the preamble itself is the treatment. Isolation, judging, timeout, and announce-stop retry stay on unless you turn them off. Set `rubric.allowedCommands` when only some shell commands are legal. Pass `--workers` to run more than one live agent at a time.

## Next

| Task | Paper |
| --- | --- |
| Flags, viewer, and check versus live | [cli.md](cli.md) |
| Rubric, compare, workspace, MCP | [suites.md](suites.md) |
| Auth and custom hosts | [hosts.md](hosts.md) |
| Sealed workspace and debug bundles | [isolation.md](isolation.md) |
| Targets and fail-on | [reliability.md](reliability.md) |

## Example path

Use the examples in this order:

1. Run `bun run test:confidence` to see the small pull-request gate.
2. Read `agent-suites/tour/scenarios.json`, then run `bun run test:tour`.
   The tour includes a stale-summary control, two authoritative MCP paths,
   and a control-versus-tool experiment.
3. Read `agent-suites/reference/scenarios.json`, then run
   `bun run test:reference`. It keeps one simple example for each public
   field, including hosts, profiles, context, skills, seed patches, ordered
   tools, sidecar rubrics, compare gates, judge metrics, routing, and skips.

Each scenario gets a fresh sealed workspace. A comparison scenario runs each
arm independently. The arm result is still shown, including an intentional
failed control. The suite result is the experiment result: all declared
absolute and pair gates must pass. This lets a test prove that a bad control
was bad without presenting that expected result as an unexpected suite failure.

For a new suite, copy the small shape below, replace the prompt and fixture
paths, and run `--check` before using host credentials:

```json
{
  "name": "my-suite",
  "hosts": ["cursor"],
  "defaults": { "allowUserSkills": false },
  "scenarios": [
    {
      "name": "reads one fact",
      "workspace": "fixtures/my-project",
      "prompt": "Read PROJECT.md. Reply with the owner.",
      "rubric": {
        "mustReadPath": ["PROJECT.md"],
        "must": ["Mina"]
      }
    }
  ]
}
```

Keep new names, descriptions, prompts, judge questions, and fixture text in
Simple English. Use exact code, command names, paths, and quoted errors where
the rubric depends on them.
