# Suites

<!-- source-of-truth: executable suite coverage and resource declaration -->
<!-- doc-meta: owner=eng | last-reviewed=2026-09-16 -->
<!-- review-deps: paths=agent-test*.config.ts,agent-suites/**/*.ts,packages/test/src/sdk/*.ts -->

A suite calls `describe(name, ({ agent, judge }) => ({ ...namedResources }))` and uses the returned test function. The callback declares resources during discovery; each test receives fresh handles. See [the SDK guide](sdk-v2.md).

| Suite | Coverage |
| --- | --- |
| tour | Project facts, diagnosis, repair judging, MCP, attached skills, explicit bad controls, repeated token measurements |
| test-sdk-capabilities | Reply checks, forbidden tools, path evidence, writes/commands, ordered MCP, explicit context, setup, isolation, skills, qualitative evaluation, controls |

The root config uses one OpenAI agent and a separate OpenAI reviewer. The matrix config runs the same tests against OpenAI, Claude, and Cursor. A full default discovery lists 18 tests; the matrix lists 54.

`agent()` resources can attach skills, context, MCP servers, workspace, or setup; individual run objects can add task resources. `judge()` resources declare a prompt and schema. Calls pass only selected JSON input. Multiple resources are ordinary named entries returned by the callback.

Comparisons use ordinary JavaScript and assertions. Repeated independent calls start fresh; `run.continue` shares the original task. Skills and MCP definitions are in [agents.ts](../agent-suites/tour/agents.ts). The repair judge sees explicitly selected source content and changed paths, not an implicit workspace copy.
