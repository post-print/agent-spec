# @post-print/agent-harness

<!-- source-of-truth: configured agent definitions and isolated harness sessions -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=packages/harness/src/*.ts,packages/harness/src/**/*.ts,packages/harness/package.json -->

Configure coding agents for agent-test. Definitions are reusable; each task session owns an isolated worker and host runtime.

```ts
import { openai, claude, cursor } from "@post-print/agent-harness";

export const coder = openai({
  auth: { type: "subscription" },
  skills: ["./skills/testing"],
  context: { instructions: ["Run the relevant tests."], files: ["./context/project.md"] },
  includeGlobalSkills: false,
});
```

`openai()` runs Codex, `claude()` runs Claude Code, and `cursor()` uses the Cursor SDK. `openrouter()` calls an OpenRouter model through the OpenAI-compatible API. All accept model and authentication options. OpenRouter defaults to `{ type: "api-key", env: "OPENROUTER_API_KEY" }`.

Factories do not launch agents. Agent-test prepares workspaces, installs attached skills, supplies context, creates sessions, and guarantees cleanup. Custom adapters use `defineAgent()` and `customAgent()`; see [the SDK guide](../../docs/sdk-v2.md#custom-agents).

Built-in continuation currently reconstructs prior conversation. Cursor does not yet support enforced read-only judge sessions; use OpenAI or Claude as the judge. ACP is not introduced by this change.
