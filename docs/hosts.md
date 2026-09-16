# Hosts

<!-- source-of-truth: host auth and custom adapters -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->

<!-- review-deps: paths=.env.example,packages/harness/src/types.ts,packages/harness/src/context.ts,packages/harness/src/adapters/index.ts,packages/harness/src/auth-mode.ts,packages/harness/src/cursor-auth.ts,packages/harness/src/claude-run.ts,packages/harness/src/openai-run.ts,packages/test/src/cli.ts,packages/test/src/load-adapters.ts -->

A **host** is the coding-agent runtime that executes a scenario. Builtin slugs are `cursor`, `claude`, and `openai`. A consumer repo can register another slug.

The CLI does not load `.env`. Export variables in the shell. Copy `.env.example` in this repo.

The judge and the default user simulator use the same host family as the test agent.

## Builtin auth

Default mode is subscription. Pass `--auth-mode api-key` (alias `--auth-method`) to bill an API key. A leftover key does not select api-key.

| Host | Binary / SDK | Subscription | API key |
| --- | --- | --- | --- |
| `cursor` | `@cursor/sdk` | `npx agent-test login` | `--auth-mode api-key` plus `CURSOR_API_KEY` |
| `claude` | `claude` or `CLAUDE_CODE_BIN` | Claude Code CLI login | `--auth-mode api-key` plus `ANTHROPIC_API_KEY` |
| `openai` | `codex` or `CODEX_BIN` | `codex login` | `--auth-mode api-key` plus `OPENAI_API_KEY` or `CODEX_API_KEY` |

The Cursor app login does not feed the SDK. Run `npx agent-test login`. That command calls `Cursor.auth.login()` and stores the key in `~/.cursor/sdk/auth.json`. It does not print the key. A TTY subscription run opens the same login when that file is missing. `npx agent-test login --host openai` runs `codex login`. For Claude, run the Claude Code CLI login.

Resolution order: `--auth-mode`, then `runAgent({ authMode })`, then `CURSOR_AUTH_MODE` / `CLAUDE_AUTH_MODE` / `OPENAI_AUTH_MODE`, then subscription.

Claude `api-key` mode uses `--bare` for compatibility preamble runs. A `host-native` run uses `--setting-sources project` with either auth mode so Claude can discover project `CLAUDE.md`, rules, and skills.

## Native workspace discovery

`contextMode: "host-native"` uses each host's own project discovery and sends the scenario prompt unchanged.

| Host | Current project discovery used by agent-test |
| --- | --- |
| Cursor | Project `.cursor/rules`, root `AGENTS.md` / `CLAUDE.md`, and project skills including `.agents/skills`, `.cursor/skills`, `.claude/skills`, and `.codex/skills`. |
| Claude | `CLAUDE.md` / `.claude/CLAUDE.md`, `.claude/rules`, and `.claude/skills` through the project setting source. Claude does not read `AGENTS.md` unless `CLAUDE.md` imports it. |
| Codex | Scoped `AGENTS.md` instructions and repository `.agents/skills` while user configuration remains isolated. |

These are host-version contracts and can change. The report records the exact initial user input agent-test submitted. Host-owned system instructions and native discovery are not exposed as one inspectable payload, so it does not infer that a particular workspace file loaded. Package-generated files are ordinary on-disk workspace context only after the package or fixture actually creates them.

OpenAI agent runs use `codex exec --json --sandbox workspace-write --cd <sealed> --ignore-user-config -c approval_policy=never`. Network access stays off unless the scenario sets `networkAccess: true`; that opt-in adds `-c sandbox_workspace_write.network_access=true` only to the workspace-write agent child. It does not apply to the read-only judge. Suite MCP servers pass as `-c mcp_servers.<name>=…`. A user `~/.codex/config.toml` model pin does not apply. When user skills stay out, the child gets a temp home with only the Codex login file. Subscription mode uses that login and strips stale API keys from the child env.

Codex judges use a read-only sandbox and `--skip-git-repo-check` so they can inspect evidence snapshots without `.git`. They may use read-only shell commands to inspect only the explicitly listed evidence paths. This does not grant network access or permission to execute project code.

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

Set `mode: "host-native"` on `loadContext` to send only the scenario prompt through a builtin adapter and leave workspace discovery to the host. The default is `harness-preamble` for compatibility.

`runAgent` / `runCursorAgent` / `runClaudeAgent` / `runOpenaiAgent` accept `timeoutMs` and `failOnUserInput` (default `true`). Set `failOnUserInput: false` to start a user simulator. The next host turn receives the original task plus the transcript.

Workspace isolation lives in [isolation.md](isolation.md).
