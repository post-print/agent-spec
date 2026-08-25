# @post-print/agent-harness

**Source of truth for** agent-harness package.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-29 -->

Host-agnostic agent runtime for capture, replay, and judging.

```ts
import {
  runAgent,
  loadContext,
  judgeTrace,
  createScenarioWorktree,
} from "@post-print/agent-harness";

const context = await loadContext({ cwd: process.cwd(), profile: "cursor" });
const session = await runAgent({
  host: "replay",
  cwd: context.cwd,
  context,
  prompt: "…",
  replayTracePath: "agent-suites/example/fixtures/replays/trace.json",
});
```

`runAgent` / `runCursorAgent` / `runClaudeAgent` accept optional `timeoutMs` (hard cap; cancels the Cursor SDK run or kills the Claude CLI process group on expiry) and `failOnUserInput` (default `true` — rejects AskQuestion / AskUserQuestion-style tools in headless runs).

Live Cursor runs use `@cursor/sdk` + `CURSOR_API_KEY`. Live Claude runs use the Claude Code CLI (binary via `CLAUDE_CODE_BIN` or `claude` on `PATH`) and require an explicit `CLAUDE_AUTH_MODE` — no default, no fallback:

- `api-key`: `ANTHROPIC_API_KEY` (metered API billing). Runs `claude -p --bare --output-format stream-json`; `--bare` skips ambient CLAUDE.md / skills discovery, and the harness injects context via the `loadContext` preamble instead.
- `subscription`: the CLI's own login (keychain OAuth, or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`). `--bare` never reads OAuth, so this mode drops it and uses `--strict-mcp-config`; the host's own hooks, plugins and CLAUDE.md are then in play, so it is less hermetic. `ANTHROPIC_API_KEY` is stripped from the child env so a stale key cannot silently bill the API.
 Claude tool names are Claude-native (`Bash`, `Read`, `Edit`, …).

Live Cursor/Claude runs capture optional `trace.usage` (`inputTokens` / `outputTokens` / `totalTokens`, plus provider cache/reasoning fields when present).

Context profiles: `shared` | `cursor` | `claude` | `skeleton`. `skeleton` loads `.skeleton/registry.md`, a short `.skeleton/config.yaml` summary, and optional `customize.alwaysInclude` basenames under `.skeleton/customize/`. Additive paths via `loadContext({ contextSources })` work on any profile; default `shared`/`cursor`/`claude` profiles stay unchanged for toolbox compatibility.

Live runs accept inline `mcpServers` (stdio or HTTP/SSE). Cursor passes them to `Agent.create`; Claude writes a temp `--mcp-config` JSON. Replay ignores them and scores committed `toolCalls` only. Ambient MCP via `local.settingSources` is not enabled.

When `outputContract` is set, `buildRoutingContract` injects hands-on / hands-off routing announce rules and requires continuing the task after the announce (do not end the turn at Routing alone).

Judge classifiers remain Cursor SDK–backed (`CURSOR_API_KEY`) for all hosts.

`createScenarioWorktree` isolates **file edits** in a detached checkout. It does not prevent hosts from loading caller context or (for Cursor local) Shell/Read against the IDE-open root — see `@post-print/agent-test` README § Isolation model.

Consumer: `@post-print/agent-test`.
