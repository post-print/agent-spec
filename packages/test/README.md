# @agent-spec/test

Jest-shaped agent scenario runner built on `@agent-spec/harness`.

## CLI

```bash
bunx agent-test --suites-dir agent-suites
bunx agent-test --suite ambient-routing
bunx agent-test --live --suite ambient-routing   # CURSOR_API_KEY required
```

Default suites root: `agent-suites/`.

## Live dogfood

Live runs need `CURSOR_API_KEY` and a suites directory. Preflight fails when `--suites-dir` is missing.

Passing live runs write staging traces under `$TMPDIR/agent-spec/sessions/<pid>-<timestamp>/` (removed on exit unless `--keep-recordings`). Use `--record-fixtures` to overwrite each scenario's committed `replayTrace` path. `--no-worktree` requires `AGENT_TEST_ALLOW_IN_PLACE=1`.

## Library

```ts
import { runAllSuites, expectTrace } from "@agent-spec/test";
```
