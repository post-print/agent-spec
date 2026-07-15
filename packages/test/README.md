# @post-print/agent-test

Jest-shaped agent scenario runner built on `@post-print/agent-harness`.

## CLI

Works under **Node >= 22** (the published `agent-test` bin):

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suite ambient-routing
npx agent-test --live --suite ambient-routing   # CURSOR_API_KEY required
```

Bun is fine for local package development (`bun install` / `bun run build` in this monorepo), but consumers do not need Bun to run suites.

Default suites root: `agent-suites/`.

Live output always uses ANSI color (including under Cursor agent shells that set `NO_COLOR`). `AGENT_TEST_VERBOSE=1` shows extra tips (OOM isolation).

## Live dogfood

Live runs need `CURSOR_API_KEY` and a suites directory. Preflight fails when `--suites-dir` is missing.

Passing live runs write staging traces under `$TMPDIR/agent-spec/sessions/<pid>-<timestamp>/` (removed on exit unless `--keep-recordings`). Use `--record-fixtures` to overwrite each scenario's committed `replayTrace` path. `--no-worktree` requires `AGENT_TEST_ALLOW_IN_PLACE=1`.

## MCP servers

Live Cursor runs can attach **inline** MCP servers from suite/scenario JSON. Ambient project/user MCP (`.cursor/mcp.json`) is not loaded — tests stay hermetic.

```json
{
  "defaults": {
    "mcpServers": {
      "docs": {
        "type": "http",
        "url": "https://example.com/mcp",
        "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" }
      }
    }
  },
  "scenarios": [
    {
      "name": "use echo",
      "prompt": "Call the echo tool with text hello.",
      "mcpServers": {
        "echo": {
          "type": "stdio",
          "command": "node",
          "args": ["packages/test/fixtures/mcp-echo/server.mjs"]
        }
      },
      "rubric": {
        "mustCallTool": ["echo:hello"],
        "mustNotCallTool": ["shell"]
      }
    }
  ]
}
```

- Suite `defaults.mcpServers` merge with scenario `mcpServers` by server name (scenario wins).
- `${ENV_VAR}` placeholders expand in `command`, `args`, `env`, `url`, `headers`, and OAuth fields at run time.
- Rubric `mustCallTool` / `mustNotCallTool` match tool **name** substrings (works with MCP name prefixes). Use `name:argFragment` to also require a substring in JSON args.
- Replay hosts ignore `mcpServers` but still score recorded `toolCalls` against those matchers.

## Library

```ts
import { runAllSuites, expectTrace } from "@post-print/agent-test";
```
