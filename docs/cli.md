# CLI

<!-- source-of-truth: TypeScript suite commands and discovery -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=packages/test/src/cli.ts,packages/test/src/sdk/cli.ts,packages/test/src/sdk/viewer.ts,packages/test/package.json -->

The CLI runs the TypeScript SDK through Playwright Test. It does not load `.env`.

| Command | Behavior |
| --- | --- |
| `agent-test test --list` | Discover tests without starting agents |
| `agent-test test tour` | Execute the default-agent tour |
| `agent-test test --config path/to/config.ts` | Use another configuration |
| `agent-test test --reporter=html` | Write a Playwright HTML report |
| `agent-test viewer --config agent-test.config.ts --port 0` | Open the localhost viewer; zero selects a free port |
| `agent-test login` | Authenticate the Cursor SDK |
| `agent-test login --host openai` | Run Codex login |

Claude users authenticate through the Claude Code CLI. Model and billing are configured on agent definitions, not legacy scenario flags.

The viewer discovers the same TypeScript tests as the CLI, retains run history during its process lifetime, and supports cancellation and stream replay after reload. Run artifacts remain under the test output directory. It binds to localhost only.

JSON suites, `--suites-dir`, `--check`, `--fail-on`, automatic judges, and the detached HTML report preview have been removed. Unknown commands fail with migration guidance. Configure deadlines, projects, workers, retries, and reporters through Playwright options and `defineConfig`.

See [the SDK guide](sdk-v2.md) for fixtures, expected failed controls, and explicit judging.
