# Hosts

<!-- source-of-truth: configured host agents and authentication -->
<!-- doc-meta: owner=eng -->
<!-- review-deps: paths=.env.example,packages/harness/src/agent-definition.ts,packages/harness/src/agent-session.ts,packages/harness/src/agent-worker.ts,packages/harness/src/claude-run.ts,packages/harness/src/openai-run.ts,packages/harness/src/openrouter-run.ts,packages/harness/src/cursor-run.ts -->

`openai()` runs Codex, `claude()` runs Claude Code, `cursor()` runs the Cursor SDK, and `openrouter()` calls an OpenRouter model through its OpenAI-compatible API. Factories create immutable definitions; each independent task creates its own worker and session.

```ts
const coder = openai({
  model: "your-supported-model",
  auth: { type: "api-key", env: "OPENAI_API_KEY" },
  timeoutMs: 600_000,
  context: { instructions: ["Run the relevant tests."] },
});
```

Omitted authentication means subscription. API-key auth names the environment variable to resolve inside the worker. It never silently falls back to a different billing mode. The CLI does not auto-load `.env`.

| Factory | Subscription login | Typical key variable |
| --- | --- | --- |
| `openai()` | `codex login` | `OPENAI_API_KEY` |
| `claude()` | Claude Code login | `ANTHROPIC_API_KEY` |
| `cursor()` | `agent-test login` | `CURSOR_API_KEY` |
| `openrouter()` | None | `OPENROUTER_API_KEY` |

Cursor app login does not authenticate the SDK. Global skills default to excluded for all definitions. Attached project skills and explicit context are configured on the definition before a test runs.

Every built-in run has a ten-minute deadline by default. Set `timeoutMs` to another finite positive number when a task needs a different bound. OpenAI, Claude, Cursor, and OpenRouter receive the same configured deadline. A timed-out run cancels its host operation, retains streamed trace evidence, and surfaces an `infrastructure` failure with code `timeout` instead of waiting for the outer Playwright deadline. In a test, a longer deadline is shortened to end five seconds before the test's own timeout, so the host always reaches its deadline first.

Agent-test separates a run that never produced evidence from an agent that behaved badly. Claude must emit its `result` event and Codex its `turn.completed` or `turn.failed` event. These `infrastructure` failure codes say nothing about the agent:

| Code | Meaning |
| --- | --- |
| `timeout` | The run passed its deadline. |
| `auth` | The host could not authenticate. |
| `binary_missing` | The host binary was not found. |
| `host_exit` | The host failed or was killed before its terminal event. The message ends with a redacted stderr tail. |
| `capture_incomplete` | The host exited 0 without its terminal event, for example on empty or unparseable output. |
| `worker_crash` | The agent worker process died. |

A terminal failure the host reports itself, such as Claude's `error_max_turns`, is an ordinary run failure, including when `is_error` is false. Output lines that cannot be parsed do not fail a complete run; the trace counts them in `artifacts.droppedOutputLines`.

Built-in conversation continuation is reconstructed. Native host discovery varies: Codex reads scoped AGENTS.md, Claude uses its project settings and CLAUDE.md (unless `loadProjectContext: false` runs it bare), and Cursor discovers supported project rules and skills. Captured evidence does not prove which undisclosed host instructions loaded.

Config selects a default judge agent; named judge resources may override it. OpenAI judges use a read-only permission profile; Claude judging restricts tools to Read/Glob/Grep. Coding agents and judges on OpenAI and Claude run under host-enforced filesystem limits that deny the caller checkout and the shared temp folder; see [isolation](isolation.md#isolation-boundary). Cursor judging is rejected until enforced read-only support exists. `networkAccess: true` is supported on OpenAI and Claude coding agents, not on their judges.

By default the Claude coding agent may use Bash, Read, Edit, Write, Glob, Grep, Agent and Skill; Skill is how Claude Code invokes the project skills it discovers, including skills attached to the definition. `claude({ tools })` sets the built-in tools the Claude coding agent can see (`--tools`) and may use. `tools: []` leaves only the suite's MCP tools, for an agent that must act only through them. `claude({ loadProjectContext: false })` with API-key auth runs Claude Code as `--bare`, which skips CLAUDE.md, rules, skills, and settings discovery. Subscription auth cannot run bare, so project settings and CLAUDE.md still load from the workspace; keep that workspace free of them. `claude({ allowUnixSockets: true })` lets the agent's sandboxed commands create Unix sockets. On Linux, Claude Code's sandbox blocks them with a seccomp filter, and headless Chrome dies at startup without them, so an agent that screenshots pages needs it. The filesystem limits are unchanged. All three options are Claude-only and throw on other hosts.

Custom integrations use `defineAgent()` and `customAgent()` with explicit capabilities. See [the adapter example](sdk-v2.md#custom-agents). The old host registry and classifier adapters are removed.

## What a run records

Every completed run carries `run.record`, also stored by operation in the execution summary: host, binary and version, requested and observed model, whether the model is pinned, auth mode, confinement, network state, setting sources, the names of overriding environment variables, package version, git SHA and dirty flag, and hashes of the suite, prompt, skills, and initial workspace.

| Host | Confinement | Reports its tools and model | Network |
| --- | --- | --- | --- |
| Claude Code | `host-enforced` | Yes, in its `init` event | Denied unless `networkAccess: true` |
| Codex | `host-enforced` | No | Denied unless `networkAccess: true` |
| Cursor and custom adapters | `detect-only` | No | Not established |

`run.exposure` states what the agent was offered. Its `source` is `host` when the host listed every tool, `mcp-query` when the harness asked each MCP server for its tools and so built-in tools are not known, and `unknown` when neither worked. `expect(run).toHaveBeenOffered("tool")` throws `ConditionsUnknownError` on an unknown catalog in either direction, so a discovery test cannot pass or fail on a run that cannot show what was offered.

The viewer marks a result `Unconfined` when the host only detects escapes, `Model unpinned` when no definition names a model, and `Uncalibrated` when this host version has no passing host probe in `.agent-test/calibration`.

Sealed Codex runs set `features.apps=false`, because a login otherwise connects the run to the account's apps: an unconfigured sealed agent called Linear and Atlassian tools while looking for a task. Enable `includeGlobalSkills` only when a run may use them.

Two limits were observed on Codex CLI 0.154.0. It can run a command without emitting a tool event, so `not.toHaveAccessedPath` and "used no tools" assertions can pass when the agent did act; assert on files the work must produce when that matters. And attached skills depend on the model: the same skill test failed on `gpt-5.6-sol` and passed on `gpt-5.6-terra` and `gpt-6-astra`. Claude Code loads a skill through its `Skill` tool rather than always reading the file, so assert with `toHaveUsedSkill`. It reports whether a command succeeded but not its exit code, so `toHaveExecutedCommand({ exitCode })` throws there instead of guessing.

Run `bun run test:probe` after upgrading a host. A sealed agent runs Node, npx, and `git commit`, uses an attached skill and an MCP tool, checks the network both ways, and runs a script that reads outside its workspace, with the host's answer read from a file rather than from tool events or the model's words. A pass calibrates that host version.
