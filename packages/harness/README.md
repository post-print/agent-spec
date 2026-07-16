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

`runAgent` / `runCursorAgent` accept optional `timeoutMs` (hard cap on `stream` + `wait`) and `failOnUserInput` (default `true` — rejects `AskQuestion`-style tools in headless runs).

Consumer: `@post-print/agent-test`.
