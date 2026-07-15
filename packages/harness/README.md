# @post-print/agent-harness

Host-agnostic agent runtime for capture, replay, and judging.

```ts
import { runAgent, loadContext, judgeTrace, createScenarioWorktree } from "@post-print/agent-harness";

const context = await loadContext({ cwd: process.cwd(), profile: "cursor" });
const session = await runAgent({
  host: "replay",
  cwd: context.cwd,
  context,
  prompt: "…",
  replayTracePath: "agent-suites/example/fixtures/replays/trace.json",
});
```

Live Cursor runs accept inline `mcpServers` (stdio or HTTP/SSE), passed through to `Agent.create`. Replay ignores them and scores committed `toolCalls` only. Ambient MCP via `local.settingSources` is not enabled.

Consumer: `@post-print/agent-test`.
