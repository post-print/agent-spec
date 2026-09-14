# Getting started

<!-- source-of-truth: first consumer run of agent-test -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-14 -->

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

Create `agent-suites/smoke/scenarios.json`:

```json
{
  "name": "smoke",
  "hosts": ["cursor"],
  "defaults": {
    "host": "cursor",
    "allowUserSkills": false
  },
  "scenarios": [
    {
      "name": "hello",
      "workspace": "agent-suites/smoke/workspaces/hello",
      "prompt": "Reply with the exact sentence: smoke ok. Do not use tools.",
      "rubric": {
        "must": ["smoke ok"],
        "mustNotCallTool": ["Shell", "Bash"]
      }
    }
  ]
}
```

Create `agent-suites/smoke/workspaces/hello/README.txt` with any short note. The runner copies that folder into a sealed temp repo.

## 3. Check without a paid run

```bash
npx agent-test --check --suites-dir agent-suites --suite smoke
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
npx agent-test --suites-dir agent-suites --suite smoke --host cursor --fail-on=behavior
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
    prompt: "Review the current change.",
    rubric: { mustReadPath: ["AGENTS.md"] },
  },
});
```

The default host is Cursor. Isolation, judging, timeout, and announce-stop retry stay on unless you turn them off. Set `rubric.allowedCommands` when only some shell commands are legal. Pass `--workers` to run more than one live agent at a time.

## Next

| Task | Paper |
| --- | --- |
| Flags, viewer, and check versus live | [cli.md](cli.md) |
| Rubric, compare, workspace, MCP | [suites.md](suites.md) |
| Auth and custom hosts | [hosts.md](hosts.md) |
| Sealed workspace and debug bundles | [isolation.md](isolation.md) |
| Targets and fail-on | [reliability.md](reliability.md) |
