# @post-print/agent-harness

**Source of truth for** agent-harness package.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

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

`runAgent` / `runCursorAgent` accept optional `timeoutMs` (hard cap on `stream` + `wait`; cancels the SDK run on expiry) and `failOnUserInput` (default `true` — rejects `AskQuestion`-style tools in headless runs).

Live Cursor runs accept inline `mcpServers` (stdio or HTTP/SSE), passed through to `Agent.create`. Replay ignores them and scores committed `toolCalls` only. Ambient MCP via `local.settingSources` is not enabled.

When `outputContract` is set, `buildRoutingContract` injects hands-on / hands-off routing announce rules and requires continuing the task after the announce (do not end the turn at Routing alone).

Consumer: `@post-print/agent-test`.
