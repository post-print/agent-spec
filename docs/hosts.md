# Hosts

<!-- source-of-truth: configured host agents and authentication -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=.env.example,packages/harness/src/agent-definition.ts,packages/harness/src/agent-session.ts,packages/harness/src/agent-worker.ts,packages/harness/src/claude-run.ts,packages/harness/src/openai-run.ts,packages/harness/src/openrouter-run.ts,packages/harness/src/cursor-run.ts -->

`openai()` runs Codex, `claude()` runs Claude Code, `cursor()` runs the Cursor SDK, and `openrouter()` calls an OpenRouter model through its OpenAI-compatible API. Factories create immutable definitions; each independent task creates its own worker and session.

```ts
const coder = openai({
  model: "your-supported-model",
  auth: { type: "api-key", env: "OPENAI_API_KEY" },
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

Built-in conversation continuation is reconstructed. Native host discovery varies: Codex reads scoped AGENTS.md, Claude uses its project settings and CLAUDE.md, and Cursor discovers supported project rules and skills. Captured evidence does not prove which undisclosed host instructions loaded.

Config selects a default judge agent; named judge resources may override it. OpenAI supports a read-only sandbox; Claude judging restricts tools to Read/Glob/Grep. Cursor judging is rejected until enforced read-only support exists. `networkAccess: true` is supported only for the OpenAI coding agent, not its judge.

Custom integrations use `defineAgent()` and `customAgent()` with explicit capabilities. See [the adapter example](sdk-v2.md#custom-agents). The old host registry and classifier adapters are removed.
