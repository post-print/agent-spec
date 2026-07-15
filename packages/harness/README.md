# @agent-spec/harness

Host-agnostic agent runtime for capture, replay, and judging.

```ts
import { runAgent, loadContext, judgeTrace, createScenarioWorktree } from "@agent-spec/harness";

const context = await loadContext({ cwd: process.cwd(), profile: "cursor" });
const session = await runAgent({
  host: "replay",
  cwd: context.cwd,
  context,
  prompt: "…",
  replayTracePath: "agent-suites/example/fixtures/replays/trace.json",
});
```

Consumer: `@agent-spec/test`.
