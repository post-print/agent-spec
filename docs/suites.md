# Suites

<!-- source-of-truth: executable suite coverage and resource declaration -->
<!-- doc-meta: owner=eng -->
<!-- review-deps: paths=agent-test*.config.ts,agent-suites/**/*.ts,packages/test/src/sdk/*.ts -->

A suite calls `describe(name, ({ agent, judge }) => ({ ...namedResources }))` and uses the returned test function. The callback declares resources during discovery; each test receives fresh handles. See [the SDK guide](sdk-v2.md).

| Suite | Coverage |
| --- | --- |
| tour | Read project files, explain and fix a bug, use task tools, follow a skill, continue a conversation, compare token use |
| test-sdk-capabilities | Check replies, file access, tool order, verified repairs, attached notes, workspace setup, workspace escape, skills, and judge answers |
| reference | One worked example per question type: discovery, clarity, cold start, and teardown, each with a control that must fail, plus known-bad answers for the shipping judges |
| host-probe | Whether the sealed environment works on a host: commands, a skill, an MCP tool, the network, and a denied path. Run it with `test:probe` after upgrading a host CLI |

`agent-suites/controls` is not a suite: its manifest lists the behavior controls that `test:sdk:contracts` runs offline with a fake host, and a control that survives fails the gate. `test:controls` runs the reference suites and their subject controls on real hosts.

The root config uses one OpenAI agent and a separate OpenAI reviewer. The matrix config runs the same tests against OpenAI, Claude, and Cursor. Both pin the models in `agent-suites/models.ts`. A full default discovery lists 50 tests, counting each declared sample; the matrix lists 150.

`agent()` resources can declare a viewer description and attach skills, context, MCP servers, a workspace, or a positive `timeoutMs`; chain `.setup(fn)` to prepare each fresh workspace; individual run objects can add task resources. Tests can declare `description` and `criteria` metadata for the setup view, and `describe(name, { description }, define)` states the suite's shared intent once. When explicit criteria are omitted, direct assertions supply the criteria; an optional static `expect(actual, "Readable criterion")` message supplies the viewer label. This discovery metadata is not sent to the host. `judge()` resources declare a prompt and schema. Calls pass only selected JSON input. Multiple resources are ordinary named entries returned by the callback.

A comparison inside one test uses ordinary JavaScript and assertions. A question about a rate, or about which of two subjects does better, uses `samples` and `variants`; see [the SDK guide](sdk-v2.md). Repeated independent calls start fresh; `run.continue` shares the original task. Skills and MCP definitions are in [agents.ts](../agent-suites/tour/agents.ts). Repair tests rerun the visible tests and held-out tests (from `agent-suites/fixtures/task-list-hidden`, never copied into a task workspace) on the final workspace copy. The release-note skill lives in `agent-suites/skills`, outside every fixture, so its presence in a workspace proves attachment. Task-service tests use a workspace with no task records. The diagnosis judge sees only the selected source and explanation.
