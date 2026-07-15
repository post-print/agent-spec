# agent-spec

Executable specs for coding-agent behavior.

## Packages

| Package | Purpose |
| --- | --- |
| [`@agent-spec/harness`](packages/harness) | Host-agnostic agent runtime: context load, replay, Cursor adapter, capture, judge |
| [`@agent-spec/test`](packages/test) | Scenario runner + `agent-test` CLI |

Consumer repos keep suites locally (for example `agent-suites/<suite>/scenarios.json`) and depend on these packages from npm.

## Develop

```bash
bun install
bun run build
bun run test
```

## Publish

```bash
bun run build
cd packages/harness && npm publish --access public
cd ../test && npm publish --access public
```
