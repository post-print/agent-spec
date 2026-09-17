# agent-spec

<!-- source-of-truth: package overview -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-17 -->
<!-- review-deps: paths=package.json,packages/*/package.json -->

Executable TypeScript tests for coding agents. `@post-print/agent-test` provides named agent/judge resources, assertions, independent tasks, and typed evaluations. `@post-print/agent-harness` provides configured agents and isolated native host sessions.

Start with [getting started](docs/getting-started.md), [the SDK guide](docs/sdk-v2.md), or [the worked examples](agent-suites/tour/tour.spec.ts). Agent definitions accept models, auth, skills, and context. Global skills default to excluded.

```sh
bun install
bun run build
node packages/test/dist/cli.js test --list
node packages/test/dist/cli.js viewer
```

The default test config selects OpenAI; the separate matrix config has OpenAI, Claude, and Cursor projects. Live tests require the selected host's authentication; the examples' OpenAI reviewer requires its own authentication. No provider-backed tests run in CI.

| Command | Purpose |
| --- | --- |
| `bun run test:unit` | Offline unit coverage |
| `bun run test:sdk:contracts` | Fake-adapter SDK integration contracts |
| `bun run test:sdk:consumer` | Install packed packages in a clean consumer and execute the public API |
| `bun run test:e2e` | Viewer browser checks; install Chromium first |
| `bun run test:tour` | Run the worked examples with OpenAI |
| `bun run test:capabilities` | Eleven manual default-agent capability tests |
| `bun run test:matrix` | Capabilities across all three host projects |
| `bun run test:reliability` | Twenty capability repetitions with no retries |

Use Node 22+ for the published packages; Bun 1.4.0 is the repository toolchain. The CLI does not load `.env`. See [hosts](docs/hosts.md), [isolation](docs/isolation.md), and [reliability](docs/reliability.md).

JSON suites, the separate rubric runner, automatic classifier judges, and standalone legacy HTML reports have been removed. Playwright owns scheduling and report generation. The viewer consumes the same TypeScript test execution events.

The strict Biome policy applies to runtime, tests, scripts, and example suites. The repository lint gate requires zero errors and warnings, including the retained native-host and viewer modules.

Publishing is handled by the repository publish workflow after merging to main. The v2 SDK changes public APIs; migrate existing suites with the SDK guide before upgrading.
