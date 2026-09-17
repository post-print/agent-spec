# Suites

<!-- source-of-truth: TypeScript suite authoring and capability coverage -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=agent-test.config.ts,agent-suites/**/*.ts,packages/test/src/sdk/*.ts -->

Write TypeScript tests using `test`, `expect`, and reusable agent definitions. [The SDK guide](sdk-v2.md) describes the API; [the tour](../agent-suites/tour/tour.spec.ts) demonstrates it.

| Suite | Coverage |
| --- | --- |
| `tour` | Project facts, diagnosis, repair, MCP, attached skills, expected controls, repeated token comparison and explicit judging |
| `test-sdk-capabilities` | Eleven manual checks of reply assertions, forbidden tools, path access, edits/commands, ordered MCP, explicit context, fixture setup, isolation, skills, judging, and comparison controls |

The root config defines OpenAI, Claude, and Cursor projects. Its default workspace is the task-list fixture. The reviewer is explicitly configured as OpenAI, independently of the tested host.

```sh
agent-test test --list
agent-test test tour --project=openai
agent-test test test-sdk-capabilities --project=cursor
```

Assertions throw and decide pass/fail. Judges return scores and evidence; they do not impose hidden acceptance thresholds. Each comparison variant may override the agent, prompt, workspace, and repetition count. Named expected failures must execute and fail; runtime and judge errors remain failures.

MCP servers are attached to an agent definition. Use absolute script paths for stdio servers that live outside the sealed fixture. Attached skills contain SKILL.md; context files resolve relative to the test config.

Fixture setup can apply a patch with ordinary Node/Git code before the first agent run. Playwright owns hooks, selection, timeouts, retries, and reports. The JSON authoring and rubric runner have been removed.
