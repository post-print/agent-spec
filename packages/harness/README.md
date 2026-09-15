# @post-print/agent-harness

<!-- source-of-truth: agent-harness package -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-15 -->

<!-- review-deps: paths=packages/harness/src/*.ts,packages/harness/src/**/*.ts,packages/harness/package.json -->

Host-agnostic runtime for direct Cursor, Claude, and OpenAI Codex execution, capture, and judging.

```ts
import {
  runAgent,
  loadContext,
  judgeTrace,
  createSealedWorkspace,
} from "@post-print/agent-harness";

const sealed = await createSealedWorkspace({ callerCwd: process.cwd() });
const context = await loadContext({ cwd: sealed.path, profile: "cursor" });
const session = await runAgent({
  host: "cursor",
  cwd: sealed.path,
  context,
  prompt: "…",
});
```

For a host-native session, keep the scenario prompt unchanged and let the host discover its supported project files:

```ts
const context = await loadContext({
  cwd: sealed.path,
  profile: "cursor",
  mode: "host-native",
});
```

`harness-preamble` remains the default for compatibility. It composes selected context sources and optional skill catalogs into the submitted user input.

Replay-based testing is deprecated and removed. `runAgent` always launches the selected agent host. Untyped calls with `host: "replay"` fail with migration guidance.

`runAgent` / `runCursorAgent` / `runClaudeAgent` / `runOpenaiAgent` accept optional `timeoutMs` and `failOnUserInput` (default `true`). Set `failOnUserInput: false` to start a user simulator that answers AskQuestion-style tools. The next host turn receives the original task plus the transcript.

## Hosts

| Host | Binary / SDK | Auth |
| --- | --- | --- |
| `cursor` | `@cursor/sdk` | Subscription after `npx agent-test login`, or `--auth-mode api-key` plus `CURSOR_API_KEY` |
| `claude` | `claude` or `CLAUDE_CODE_BIN` | Subscription after Claude Code login, or `--auth-mode api-key` plus `ANTHROPIC_API_KEY` |
| `openai` | `codex` or `CODEX_BIN` | Subscription after `codex login`, or `--auth-mode api-key` plus `OPENAI_API_KEY` or `CODEX_API_KEY` |
| custom slug | your `HostAdapter` | `missingAuth()` on the adapter |

A consumer repo can add a host. Implement `HostAdapter` and call `registerHostAdapter`. Builtin ids stay reserved.

```ts
import { registerHostAdapter, type HostAdapter, runAgent } from "@post-print/agent-harness";

const gemini: HostAdapter = {
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
};

registerHostAdapter(gemini);
await runAgent({ host: "gemini", cwd: process.cwd(), prompt: "…" });
```

For `agent-test`, put adapters in `agent-test.config.mjs` or pass `--adapter ./hosts/gemini.mjs`. Isolated children load the same config.

Set `classifierHost` to `cursor`, `claude`, or `openai`, or implement `classify()`. A custom host without one cannot run the judge.

Claude `api-key` mode uses `--bare` for harness-preamble runs and project setting sources for host-native runs. Subscription mode uses `--strict-mcp-config`. OpenAI agent runs use `codex exec --json --sandbox workspace-write --cd <sealed> --ignore-user-config -c approval_policy=never`. Pass `networkAccess: true` to add `-c sandbox_workspace_write.network_access=true` to that workspace-write child; omitted or `false` stays offline. Suite MCP servers pass to Codex as `-c mcp_servers.<name>=…`. A user `~/.codex/config.toml` model pin does not apply. When user skills stay out, the Codex child gets a temp home with only its login file.

## Skills

The sealed workspace is a git repo. Each host discovers its own project skill roots: Cursor uses `.cursor/skills` and `.agents/skills`, Claude uses `.claude/skills`, and Codex uses `.agents/skills`. Optional `skills` paths are only used by harness-preamble mode to build a synthetic catalog. Host-global user skills stay out unless `allowUserSkills` is true. The deny path uses Cursor `settingSources: ["project"]` plus a temp `HOME` with no skill trees, Claude project-only settings or `--bare`, and Codex `--ignore-user-config` plus an auth-only temp home. The judge scores any criterion against the full transcript, including tool names, args, and results. A tool result is an outcome.

## Isolation

`createSealedWorkspace` copies `git archive HEAD` plus caller context (rules, skill trees, `AGENTS.md`, `skeleton.toml`) into a temp folder. Pass `workspace` to copy a caller-relative folder instead. It then runs `git init` in that folder so git does not walk to the caller repo. Cursor file and shell tools use that same folder. The test runner fails the scenario when tool paths leave it. Cursor's temporary large-output files are host evidence and do not count as leaks.

## Judge

`judgeTrace` uses the same host family as the test agent. Default auth is subscription. Cursor judge calls use the SDK login store, or `CURSOR_API_KEY` when `--auth-mode api-key` is set. Claude and OpenAI judges use their own host credentials.

The Cursor app login does not feed the SDK. Run `npx agent-test login`, or pass `--auth-mode api-key` plus `CURSOR_API_KEY`. Subscription mode uses the Codex CLI login and strips stale API keys from the child env.

Consumer: `@post-print/agent-test`. Auth and adapters: [docs/hosts.md](../../docs/hosts.md). Sealed workspace: [docs/isolation.md](../../docs/isolation.md).
