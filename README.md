# agent-spec

**Source of truth for** package overview.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

Executable specs for coding-agent behavior.

## Packages

| Package                                         | Purpose                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@post-print/agent-harness`](packages/harness) | Host-agnostic agent runtime: context load, replay, Cursor adapter, capture, judge |
| [`@post-print/agent-test`](packages/test)       | Scenario runner + `agent-test` CLI                                                |

Consumer repos keep suites locally (for example `agent-suites/<suite>/scenarios.json`) and depend on these packages from npm.

## Consumer usage (Node >= 22)

Published packages are native ESM and run under Node (no Bun required at runtime):

```bash
npx agent-test --suites-dir agent-suites
npx agent-test --suites-dir agent-suites --live   # CURSOR_API_KEY required
```

## Develop

Local builds still use Bun:

```bash
bun install
bun run build
bun run test
```

## Publish

Merging to `main` (or `workflow_dispatch` on `.github/workflows/publish.yml`) publishes a patch by default. Manual publish:

```bash
bun run build
cd packages/harness && npm publish --access public
cd ../test && npm publish --access public
```
