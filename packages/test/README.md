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

### Color

Chalk colors follow the usual rules (`NO_COLOR` disables; `FORCE_COLOR=1` forces). Cursor agent shells often set `NO_COLOR=1` — use:

```bash
FORCE_COLOR=1 npm run agent:test:live -- --suite routing
# or
AGENT_TEST_COLOR=1 npm run agent:test:live -- --suite routing
```

`AGENT_TEST_VERBOSE=1` shows extra tips (OOM isolation, color flags).

## Live dogfood

Live runs need `CURSOR_API_KEY` and a suites directory. Preflight fails when `--suites-dir` is missing.

Passing live runs write staging traces under `$TMPDIR/agent-spec/sessions/<pid>-<timestamp>/` (removed on exit unless `--keep-recordings`). Use `--record-fixtures` to overwrite each scenario's committed `replayTrace` path. `--no-worktree` requires `AGENT_TEST_ALLOW_IN_PLACE=1`.

## Library

```ts
import { runAllSuites, expectTrace } from "@post-print/agent-test";
```
