# @post-print/agent-test

**Source of truth for** agent-test package.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-16 -->

Jest-shaped agent scenario runner built on `@post-print/agent-harness`.

## CLI

Works under **Node >= 22** (the published `agent-test` bin):

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --suite ambient-routing
npx agent-test --suites-dir agent-suites --live --suite ambient-routing   # CURSOR_API_KEY required
npx agent-test --doctor
```

Bun is fine for local package development (`bun install` / `bun run build` in this monorepo), but consumers do not need Bun to run suites.

Default suites root: `agent-suites/` (must exist, or pass `--suites-dir`). In this monorepo (no consumer suites), smoke the built CLI against fixtures:

```bash
node packages/test/dist/cli.js --suites-dir packages/test/fixtures --suite smoke
```

Live output always uses ANSI color (including under Cursor agent shells that set `NO_COLOR`).

## Environment variables

See repo-root `.env.example`. Common knobs:

| Variable                                    | Purpose                                          |
| ------------------------------------------- | ------------------------------------------------ |
| `CURSOR_API_KEY`                            | Required for `--live` and judge classifiers      |
| `AGENT_TEST_VERBOSE`                        | Extra tips (e.g. OOM isolation) when `1`         |
| `AGENT_TEST_VERBOSE_PATHS`                  | Print full paths when `1`                        |
| `AGENT_TEST_QUIET`                          | Suppress progress when `1`                       |
| `AGENT_TEST_TIMEOUT_MS`                     | Live hard timeout (default 600000; `0` disables) |
| `AGENT_TEST_ALLOW_IN_PLACE`                 | Allow `--no-worktree` live runs when `1`         |
| `AGENT_TEST_NO_WORKTREE`                    | Disable worktree isolation when `1`/`true`       |
| `AGENT_TEST_NO_ISOLATE`                     | Disable isolated subprocesses when `1`           |
| `AGENT_TEST_SCENARIO_SETTLE_MS`             | Settle delay between live scenarios              |
| `CURSOR_AGENT_MODEL` / `CURSOR_JUDGE_MODEL` | Optional model overrides                         |
| `CURSOR_JUDGE_TEMPERATURE`                  | Optional judge temperature                       |

## Live dogfood

Live runs need `CURSOR_API_KEY` and a suites directory that exists. Preflight fails when the resolved suites directory is missing (default `agent-suites/` if `--suites-dir` is omitted).

Passing live runs write staging traces under `$TMPDIR/agent-spec/sessions/<pid>-<timestamp>/` (removed on exit unless `--keep-recordings`). Use `--record-fixtures` to overwrite each scenario's committed `replayTrace` path. `--no-worktree` requires `AGENT_TEST_ALLOW_IN_PLACE=1`.

Live agent runs have a **hard timeout** (default **10 minutes**, override with `--timeout-ms` or `AGENT_TEST_TIMEOUT_MS`; disable with `--no-timeout` or `AGENT_TEST_TIMEOUT_MS=0`). If the agent invokes `AskQuestion` or similar user-input tools, the harness fails fast with a clear error — live mode is single-shot and cannot supply follow-up turns. Use `--allow-user-input` only for intentional multi-turn dogfood (the run may still hang waiting for stdin).

### Dialogue skills in live runs

Skills that expect multi-turn Socratic dialogue (for example `crystallize`) will hang or fail in `--live` unless the scenario is written for one-shot completion:

- **Replay-only** — commit a golden trace where the agent finishes without asking questions; use `host: "replay"` or `skip: true` with live skipped at suite level.
- **One-shot live prompt** — instruct the agent to mirror intent and emit the final artifact in a single turn (`no AskQuestion; produce Crystallized idea now`).
- **Ambient routing** — fuzzy-intent scenarios that only require mirroring + one assumption are naturally one-shot; full crystallize dialogue is not.

Do not weaken dialogue-first product skills for CI; reshape the suite contract instead.

## Library

```ts
import { runAllSuites, expectTrace } from "@post-print/agent-test";
```
