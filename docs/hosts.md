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

Agent-test separates a run that never produced evidence from an agent that behaved badly. Claude must emit its `result` event, Codex its `turn.completed` or `turn.failed` event, and OpenRouter a stream ending in `[DONE]` after a reply or a finish reason. Cursor must report `finished` and show an assistant message or tool call. Only an explicit success completes a run, so a status the harness does not recognize is a failure. These `infrastructure` failure codes say nothing about the agent:

| Code | Meaning |
| --- | --- |
| `timeout` | The run passed its deadline. |
| `auth` | The host could not authenticate, or a configured API key is missing. |
| `binary_missing` | The host binary was not found. |
| `host_exit` | The host failed or was killed before its terminal event, reported success and then exited non-zero or on a signal, could not be started (for example `EACCES`, or `E2BIG` on a prompt too large for its arguments), or was cancelled. An OpenRouter request it rejects for another reason, such as an unknown model, and anything the Cursor SDK throws that names no other cause, are also here. The message ends with a redacted stderr tail where there is one. |
| `capture_incomplete` | The run ended without its terminal event while the transport looked healthy, for example on exit 0 with empty or unparseable output, or an OpenRouter response that was empty, cut off, or not a stream. |
| `provider_unavailable` | The model provider could not serve the run: rate limit or quota (429), payment required (402), overload or server error (5xx, 529), an unreachable provider, or a failure OpenRouter reports mid-stream. |
| `worker_crash` | The agent worker process died. The session kills the host process group with it. |
| `judge_failed` | A judge's request could not be prepared, its host reported a failed turn, or its reply did not match the judge's schema. The judge gave no verdict, so the test has none. A crash, login failure, or timeout keeps its own code. |

A terminal failure the host reports itself, such as Claude's `error_max_turns`, is the agent's own outcome, including when `is_error` is false. It is thrown as `AgentOutcomeError` and charged to the agent. So is a Cursor run with status `error` and no recognized cause, because the SDK does not separate those from agent outcomes. Output lines that cannot be parsed do not fail a complete run; the trace counts them in `artifacts.droppedOutputLines`.

Classification reads what the host itself reports: Claude's `api_error_status` and `api_error`, the Cursor SDK's error classes and run error, OpenRouter's HTTP status and stream `error`, and the start of the message in Codex's `turn.failed` or `error` event and Claude's error result. Stderr counts only when the host exited non-zero before any terminal event, and its lines must start with the host's own wording. Text that merely quotes an error, such as an agent saying a request returned 401, never classifies a failure. A custom adapter classifies a failure by throwing `AgentInfrastructureError` for the host or `AgentOutcomeError` for the agent's own outcome. A plain error is untyped whatever its message says: it leaves the test with no verdict (`instrument_error`) and is never charged to the agent.

Codex emits `error` for retryable stream problems such as "Reconnecting... 1/5" as well as for fatal ones, so its turn's terminal event decides. An `error` followed by `turn.completed` completes the run and leaves the message in `artifacts.openaiRecoveredErrors`. An `error` with no later terminal event fails as `host_exit`, or with the code its message names. OpenRouter's `finish_reason` other than `error`, such as `length`, completes a run that has reply text and is kept in `artifacts.openrouterFinishReason`. With no text, it fails as `capture_incomplete`.

Failure messages, failure artifacts, and stored results are redacted of common secret shapes, apart from what Playwright writes itself, such as terminal output and `error-context.md`: `sk-` and GitHub, AWS, and Slack tokens, JWTs, passwords in URLs, bearer tokens, and values assigned to names such as `apiKey`, `token`, or `password`, in JSON or plain text. This is pattern matching, not a guarantee.

Codex runs copy the login into a temporary home, `agent-harness-openai-home-*`, which records its owner. A later run removes homes over an hour old whose owner is gone. A home with no owner record, including one from an older version, is left alone.

Built-in conversation continuation is reconstructed. Native host discovery varies: Codex reads scoped AGENTS.md, Claude uses its project settings and CLAUDE.md (unless `loadProjectContext: false` runs it bare), and Cursor discovers supported project rules and skills. Captured evidence does not prove which undisclosed host instructions loaded.

Config selects a default judge agent; named judge resources may override it. OpenAI judges use a read-only permission profile; Claude judging restricts tools to Read/Glob/Grep. Coding agents and judges on OpenAI and Claude run under host-enforced filesystem limits that deny the caller checkout and the shared temp folder; see [isolation](isolation.md#isolation-boundary). Cursor judging is rejected until enforced read-only support exists. `networkAccess: true` is supported on OpenAI and Claude coding agents, not on their judges.

Claude judges receive the schema through `--json-schema`, and the verdict comes from the `structured_output` field of the `result` event. OpenAI judges receive it through `--output-schema`, and the verdict comes from the final message. Codex fails a turn on a schema its strict mode refuses, so a schema with an optional field, an open object, a tuple, or a non-object root is sent only in the prompt. So is a `format`, which a live probe on Codex CLI 0.154.0 did not show working. OpenRouter and custom adapters also receive it only in the prompt. Every reply is validated against the schema either way.

By default the Claude coding agent may use Bash, Read, Edit, Write, Glob, Grep, Agent and Skill; Skill is how Claude Code invokes the project skills it discovers, including skills attached to the definition. `claude({ tools })` sets the built-in tools the Claude coding agent can see (`--tools`) and may use. `tools: []` leaves only the suite's MCP tools, for an agent that must act only through them. `claude({ loadProjectContext: false })` with API-key auth runs Claude Code as `--bare`, which skips CLAUDE.md, rules, skills, and settings discovery. Subscription auth cannot run bare, so project settings and CLAUDE.md still load from the workspace; keep that workspace free of them. `claude({ allowUnixSockets: true })` lets the agent's sandboxed commands create Unix sockets. On Linux, Claude Code's sandbox blocks them with a seccomp filter, and headless Chrome dies at startup without them, so an agent that screenshots pages needs it. The filesystem limits are unchanged. All three options are Claude-only and throw on other hosts.

Custom integrations use `defineAgent()` and `customAgent()` with explicit capabilities. See [the adapter example](sdk-v2.md#custom-agents). The old host registry and classifier adapters are removed.

## What a run records

Every completed run carries `run.record`, also stored by operation in the execution summary: host, binary and version, requested and observed model, whether the model is pinned, auth mode, confinement, network state, setting sources, whether the host's own user configuration can reach the run (`userConfig`), the names of overriding environment variables, package version, git SHA and dirty flag, and hashes of the suite, prompt, skills, and initial workspace.

| Host | Confinement | Reports its tools and model | Network |
| --- | --- | --- | --- |
| Claude Code | `host-enforced` | Yes, in its `init` event | Denied unless `networkAccess: true` |
| Codex | `host-enforced` | No | Denied unless `networkAccess: true` |
| Cursor and custom adapters | `detect-only` | No | Not established |

`run.exposure` states what the agent was offered. Its `source` is `host` when the host listed every tool, `mcp-query` when the harness asked each MCP server for its tools and so built-in tools are not known, and `unknown` when neither worked. `expect(run).toHaveBeenOffered("tool")` answers yes for a tool on the list, and otherwise throws `ConditionsUnknownError` in either direction when the catalog is unknown or partial, or a server is not connected. Under `mcp-query`, ask about an MCP tool by listed name or `mcp__<server>__<tool>`; other names refuse because built-ins are not known, so a discovery test cannot pass or fail on a run that cannot show what was offered.

`userConfig` is `excluded` only when the harness shuts the host's own configuration out: Claude Code under `--bare` (API-key auth with `loadProjectContext: false`), and Codex with `--ignore-user-config` and a temporary home. Claude Code under subscription auth cannot run bare, so a user CLAUDE.md, hooks, or plugins may load, and the record says `may-load`. Cursor and custom adapters record `unknown`. A change in `userConfig` starts a baseline over.

The viewer marks a result `Unconfined` when the host only detects escapes, `Model unpinned` when no definition names a model, `User config may load` when `userConfig` is `may-load`, and `Uncalibrated` when this host version and auth mode have no passing host probe in `.agent-test/calibration` from the last seven days.

Sealed Codex runs set `features.apps=false`, because a login otherwise connects the run to the account's apps: an unconfigured sealed agent called Linear and Atlassian tools while looking for a task. Enable `includeGlobalSkills` only when a run may use them.

Two limits were observed on Codex CLI 0.154.0. It can run a command without emitting a tool event, so a check that a command, read or access did not happen cannot be shown there. Built-in Codex and Cursor sessions declare `commandEventsComplete: false`, and `.not` on those matchers throws `ConditionsUnknownError`. An assertion such as `expect(run.toolCalls).toEqual([])` is not guarded and can still pass when the agent did act, so assert on files the work must produce. A custom adapter declares `commandEventsComplete: true` only when it reports every command its agent runs. And attached skills depend on the model: the same skill test failed on `gpt-5.6-sol` and passed on `gpt-5.6-terra` and `gpt-6-astra`. Claude Code loads a skill through its `Skill` tool rather than always reading the file, so assert with `toHaveUsedSkill`. It reports whether a command succeeded but not its exit code, so `toHaveExecutedCommand({ exitCode })` throws there instead of guessing.

Run `bun run test:probe` after upgrading a host. A sealed agent runs Node, npx, and `git commit`, uses an attached skill and an MCP tool, checks the network both ways, and runs a script that reads outside its workspace, with the host's answer read from a file rather than from tool events or the model's words. A pass calibrates that host version under that auth mode for seven days.
