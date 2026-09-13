# @post-print/agent-harness

**Source of truth for** agent-harness package.

<!-- doc-meta: owner=eng | last-reviewed=2026-09-13 -->

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

Replay-based testing is deprecated and removed. `runAgent` always launches the selected agent host. Untyped calls with `host: "replay"` fail with migration guidance.

`runAgent` / `runCursorAgent` / `runClaudeAgent` / `runOpenaiAgent` accept optional `timeoutMs` and `failOnUserInput` (default `true`). Set `failOnUserInput: false` to start a user simulator that answers AskQuestion-style tools. The next host turn receives the original task plus the transcript.

## Hosts

| Host | Binary / SDK | Auth |
| --- | --- | --- |
| `cursor` | `@cursor/sdk` | `CURSOR_API_KEY` |
| `claude` | `claude` or `CLAUDE_CODE_BIN` | `CLAUDE_AUTH_MODE` plus `ANTHROPIC_API_KEY` or a Claude Code login |
| `openai` | `codex` or `CODEX_BIN` | `OPENAI_API_KEY` or `CODEX_API_KEY` |

Claude `api-key` mode uses `--bare`. Subscription mode uses `--strict-mcp-config`. OpenAI agent runs use `codex exec --json --sandbox workspace-write --cd <sealed>`.

## Skills

The sealed workspace is a git repo. Hosts load project skills from `.agents/skills`, `.cursor/skills`, `.codex/skills`, and `.claude/skills`. Optional `skills` paths only overlay extra folders that are not already in that repo. The judge scores any criterion against the full transcript, including tool names, args, and results. A tool result is an outcome.

## Isolation

`createSealedWorkspace` copies `git archive HEAD` plus caller context (rules, skill trees, `AGENTS.md`) into a temp folder. It then runs `git init` in that folder so git does not walk to the caller repo. The test runner fails the scenario when tool paths leave that folder.

## Judge

`judgeTrace` uses the same host family as the test agent. Cursor judge calls still need `CURSOR_API_KEY`. Claude and OpenAI judges use their own host credentials.

Consumer: `@post-print/agent-test`.
