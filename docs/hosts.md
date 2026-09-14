# Hosts

<!-- source-of-truth: host auth and custom adapters -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

<!-- review-deps: paths=.env.example,packages/harness/src/types.ts,packages/harness/src/auth-mode.ts,packages/test/src/load-adapters.ts -->

A **host** is the coding-agent runtime that executes a scenario. Builtin slugs are `cursor`, `claude`, and `openai`. A consumer repo can register another slug.

The CLI does not load `.env`. Export variables in the shell. Copy `.env.example` in this repo.

The judge and the default user simulator use the same host family as the test agent.

## Builtin auth

| Host | Binary / SDK | Auth |
| --- | --- | --- |
| `cursor` | `@cursor/sdk` | `CURSOR_API_KEY`, or `CURSOR_AUTH_MODE=subscription` after `Cursor.auth.login()` |
| `claude` | `claude` or `CLAUDE_CODE_BIN` | `CLAUDE_AUTH_MODE` plus `ANTHROPIC_API_KEY` or a Claude Code login |
| `openai` | `codex` or `CODEX_BIN` | `OPENAI_API_KEY` or `CODEX_API_KEY`, or `OPENAI_AUTH_MODE=subscription` after `codex login` |

The Cursor app login does not feed the SDK. Run `Cursor.auth.login()` once, or set `CURSOR_API_KEY`.

`CURSOR_AUTH_MODE` unset plus `CURSOR_API_KEY` uses api-key. `OPENAI_AUTH_MODE` unset plus a Codex key uses api-key.

Claude `api-key` mode uses `--bare`. Subscription mode uses `--strict-mcp-config`.

OpenAI agent runs use `codex exec --json --sandbox workspace-write --cd <sealed> --ignore-user-config -c approval_policy=never`. Suite MCP servers pass as `-c mcp_servers.<name>=…`. A user `~/.codex/config.toml` model pin does not apply. `OPENAI_AUTH_MODE=subscription` uses the Codex CLI login and strips stale API keys from the child env.

Optional model pins:

| Variable | Host |
| --- | --- |
| `CURSOR_AGENT_MODEL` | Cursor agent |
| `CURSOR_JUDGE_MODEL` | Cursor judge |
| `CLAUDE_AGENT_MODEL` | Claude agent |
| `CODEX_AGENT_MODEL` | Codex agent |

Unset uses the host default.

## Host selection

Set the host in this order. The first set value wins for a scenario:

1. `scenario.host`
2. CLI `--host`
3. `defaults.host`
4. `cursor`

`--host cursor,claude` or repeated `--host` flags run a matrix. `--host all` expands to every registered builtin plus loaded adapters.

`scenario.host` pins that scenario. A matrix run skips it on the other hosts.

## Custom adapter

Implement `HostAdapter` and register it. Do not reuse `cursor`, `claude`, `openai`, `replay`, or `all` as the slug.

```js
// agent-test.config.mjs
import { defineConfig } from "@post-print/agent-test";

export default defineConfig({
  adapters: [
    {
      host: "gemini",
      missingAuth() {
        return process.env.GEMINI_API_KEY ? undefined : "GEMINI_API_KEY not set";
      },
      classifierHost: "cursor",
      async run(options) {
        return {
          host: "gemini",
          status: "completed",
          durationMs: 0,
          trace: {
            messages: [{ role: "assistant", content: options.prompt }],
            toolCalls: [],
            shellCommands: [],
            artifacts: {},
          },
        };
      },
    },
  ],
});
```

Then `--host gemini` and a suite `hosts` list can include `gemini`. You can also pass `--adapter ./hosts/gemini.mjs`. The module can export `{ adapters: [...] }` or call `registerHostAdapter` as a side effect. Isolated children load the same configuration.

From TypeScript:

```ts
import { registerHostAdapter, type HostAdapter, runAgent } from "@post-print/agent-harness";
```

`missingAuth()` returns a message when the host cannot run. Return `undefined` when it can.

Set `classifierHost` to `cursor`, `claude`, or `openai`, or implement `classify()`. A custom host without one cannot run the judge. `missingClassifierAuth()` reports judge credential gaps.

## Runtime API

`runAgent` always launches the selected host. Untyped `host: "replay"` fails with migration guidance.

```ts
import { runAgent, loadContext, createSealedWorkspace } from "@post-print/agent-harness";

const sealed = await createSealedWorkspace({ callerCwd: process.cwd() });
const context = await loadContext({ cwd: sealed.path, profile: "cursor" });
const session = await runAgent({
  host: "cursor",
  cwd: sealed.path,
  context,
  prompt: "…",
});
```

`runAgent` / `runCursorAgent` / `runClaudeAgent` / `runOpenaiAgent` accept `timeoutMs` and `failOnUserInput` (default `true`). Set `failOnUserInput: false` to start a user simulator. The next host turn receives the original task plus the transcript.

Workspace isolation lives in [isolation.md](isolation.md).
