# Hosts

<!-- source-of-truth: configured host agents and authentication -->
<!-- doc-meta: owner=eng | last-reviewed=2026-10-15 -->
<!-- review-deps: paths=.env.example,packages/harness/src/agent-definition.ts,packages/harness/src/agent-session.ts,packages/harness/src/agent-worker.ts,packages/harness/src/claude-run.ts,packages/harness/src/openai-run.ts,packages/harness/src/openrouter-run.ts,packages/harness/src/cursor-run.ts -->

`openai()` runs Codex, `claude()` runs Claude Code, `cursor()` runs the Cursor SDK, and `openrouter()` calls an OpenRouter model through its OpenAI-compatible API. Factories create immutable definitions; each independent task creates its own worker and session.

```ts
const coder = openai({
  model: "your-supported-model",
  auth: { type: "api-key", env: "OPENAI_API_KEY" },
  timeoutMs: 600_000,
  context: { instructions: ["Run the relevant tests."] },
});
```

Omitted authentication means subscription. API-key auth names the environment variable to resolve inside the worker. It never silently falls back to a different billing mode. The CLI does not auto-load `.env`.

| Factory | Subscription login | Typical key variable |
| --- | --- | --- |
| `openai()` | `codex login` | `OPENAI_API_KEY` |
| `claude()` | Claude Code login | `ANTHROPIC_API_KEY` |
| `cursor()` | `agent-test login` | `CURSOR_API_KEY` |
| `openrouter()` | None | `OPENROUTER_API_KEY` |

Cursor app login does not authenticate the SDK. Global skills default to excluded for all definitions. Attached project skills and explicit context are configured on the definition before a test runs.

Every built-in run has a ten-minute deadline by default. Set `timeoutMs` to another finite positive number when a task needs a different bound. OpenAI, Claude, Cursor, and OpenRouter receive the same configured deadline. A timed-out run cancels its host operation, retains streamed trace evidence, and surfaces an `infrastructure` failure with code `timeout` instead of waiting for the outer Playwright deadline.

Built-in conversation continuation is reconstructed. Native host discovery varies: Codex reads scoped AGENTS.md, Claude uses its project settings and CLAUDE.md (unless `loadProjectContext: false` runs it bare), and Cursor discovers supported project rules and skills. Captured evidence does not prove which undisclosed host instructions loaded.

Config selects a default judge agent; named judge resources may override it. OpenAI judges use a read-only permission profile; Claude judging restricts tools to Read/Glob/Grep. Coding agents and judges on OpenAI and Claude run under host-enforced filesystem limits that deny the caller checkout and the shared temp folder; see [isolation](isolation.md#isolation-boundary). Cursor judging is rejected until enforced read-only support exists. `networkAccess: true` is supported only for the OpenAI coding agent, not its judge.

By default the Claude coding agent may use Bash, Read, Edit, Write, Glob, Grep, Agent and Skill; Skill is how Claude Code invokes the project skills it discovers, including skills attached to the definition. `claude({ tools })` sets the built-in tools the Claude coding agent can see (`--tools`) and may use. `tools: []` leaves only the suite's MCP tools, for an agent that must act only through them. `claude({ loadProjectContext: false })` with API-key auth runs Claude Code as `--bare`, which skips CLAUDE.md, rules, skills, and settings discovery. Subscription auth cannot run bare, so project settings and CLAUDE.md still load from the workspace; keep that workspace free of them. Both options are Claude-only and throw on other hosts.

Custom integrations use `defineAgent()` and `customAgent()` with explicit capabilities. See [the adapter example](sdk-v2.md#custom-agents). The old host registry and classifier adapters are removed.
