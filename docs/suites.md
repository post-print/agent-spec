# Suites

<!-- source-of-truth: JSON suite and scenario authoring -->

<!-- doc-meta: owner=eng | last-reviewed=2026-09-14 -->

<!-- review-deps: paths=packages/test/src/types.ts,packages/test/src/compare-scenario.ts,packages/test/src/validate-suite.ts,packages/test/src/command-allowlist.ts,packages/test/src/expect.ts,agent-suites/**/scenarios.json -->

A **suite** is `agent-suites/<name>/scenarios.json`. A **scenario** is one prompt plus a rubric. JSON loads into `runAgentTest`. It is not a stored answer.

Layout:

```
agent-suites/
  smoke/
    scenarios.json
    workspaces/
      hello/
        README.txt
```

`--suites-dir` points at the parent of those suite folders. Default is `agent-suites`.

## Suite file

| Field | Role |
| --- | --- |
| `name` | Suite id. |
| `description` | Optional note. |
| `hosts` | Host matrix. A run expands once per host. `--host` filters the list. |
| `defaults` | Host, profile, skills, context, MCP, workspace, `allowUserSkills`. |
| `scenarios` | Scenario list. |

`defaults.host` must appear in `hosts` when both are set. An empty `hosts` list fails `--check`.

## Scenario fields

| Field | Role |
| --- | --- |
| `name` | Scenario id. |
| `description` | Optional plain-language note. It says what the scenario tests. |
| `prompt` | User prompt sent to the host. |
| `compare` | Two or more live arms. See Compare below. |
| `host` | Pin this scenario to one host. A matrix run skips it on the other hosts. |
| `profile` | Context profile: `shared`, `cursor`, `claude`, or `skeleton`. |
| `workspace` | Caller-relative folder that becomes the sealed repo. Omit or `"."` copies HEAD. |
| `skills` | Extra repo-relative skill folders, or `"none"`. |
| `contextSources` | Extra files loaded into the preamble. |
| `mcpServers` | Inline MCP servers. Merge over suite defaults by server name. |
| `allowUserSkills` | Load host-global user skills. Default `false`. |
| `seedPatch` | Caller-repo patch path. Hunks are relative to the workspace. |
| `seedStageOnly` | Stage the seed without a commit. |
| `rubric` | Matchers and optional judge questions. |
| `skip` | Skip this scenario. |

Scenario `workspace` wins over suite `defaults.workspace`. Scenario `allowUserSkills` wins over the suite default.

`contextSources` and `skills` are relative to the workspace root when `workspace` is a subfolder. A bare `contextSources` name is a file in that root.

Sidecar rubrics: omit inline rubric keys when a sibling `rubrics.json` / `scenarios.rubric.json` or `--rubrics-dir` supplies them.

## Rubric matchers

Deterministic matchers read the transcript. Each row states which parts of the trace it searches.

| Key | Pass when |
| --- | --- |
| `must` | Each string appears in assistant reply text. Tool results, commands, and artifacts do not count. |
| `mustNot` | None of the strings appear in text, commands, artifacts, or tool args. Tool results are ignored. |
| `mustRun` | Each string appears in a shell command. |
| `allowedCommands` | Every shell statement includes one listed fragment. Combined commands split on `&&`, `||`, `;`, `|`, and newlines. An empty list forbids every shell command. Omit the key for no allowlist. |
| `mustCallTool` | A tool name substring matches. `name:fragment` also requires the fragment in JSON args or the tool result. |
| `mustNotCallTool` | No matching tool call. |
| `mustReadPath` | A Read-family arg or a Shell/Bash path access contains the substring. |
| `mustNotReadPath` | No Read tool arg contains the substring. |
| `mustInvokeSkill` | The agent reads that skill `SKILL.md` or a file under its references. The judge then scores follow-through. |
| `mustNotInvokeSkill` | The agent does not read that skill path. |
| `judge` | LLM questions. Each item is a string, or `{ "id", "question" }`. |
| `tier` | Optional `low` / `medium` / `high`. |
| `handsOnRouting` | Infer a one-line routing contract from the transcript. |
| `routingBlock` | Optional routing-contract check. |
| `reviewDepth` | Optional `quick` / `standard` / `thorough` / `full`. |

The judge sees assistant text, tool args, and tool results. `--no-judge` skips judge questions and the `mustInvokeSkill` follow-up. Deterministic matchers still run.

Score a file write with `mustCallTool` `Write:<token>`. The token must appear in the tool args. Reply text does not count.

Set `allowedCommands` when Shell is allowed, but only some commands are legal. The scorer splits combined lines. `npm install @pkg && eslint .` fails if `eslint` is not on the list. The host can still run the command. The scenario then fails.

## Compare

A compare scenario runs two or more live arms. Each arm must have a `description`. That note says what the arm tests. Each arm can override prompt, host, workspace, skills, context, MCP, seed, `allowUserSkills`, and extra rubric checks.

Use `compare.a` and `compare.b` for two arms. If you omit `label`, arm a is named control. Arm b is named experimental.

Use `compare.arms` when the scenario has more than two workspaces. Each named arm needs `id`, `description`, and a workspace when the trees differ. The id is a lowercase slug such as `skel-clean`.

Arm rubric arrays append onto the scenario rubric. Do not put `judge` on an arm. `rubric.judge` stays on the scenario. The judge sees every arm transcript. It does not pick one winner.

The live verdict lists each arm. Shared rubric checks appear under every arm. Extra arm checks stay on that arm. Faster and cheaper gates sit in a compare section. Each check shows pass or fail. The HTML report and the viewer list a winner for turns, tokens, and tools. Named pairs still do not pick one overall winner. Two-arm chats sit side by side. Three or more arms use tabs to switch chats.

For two arms, `compare.faster` and `compare.cheaper` name the arm that must win. The win is a strict less-than on agent turns or total tokens.

An agent turn is one assistant message on the trace. The harness joins stream tokens into that message, then starts a new turn after tools.

When `compare.arms` has more than two arms, name winner-versus-loser pairs. A 2x2 must not require one arm to beat every other arm. Do not invent a four-way winner.

```json
{
  "name": "cheaper prompt",
  "description": "Checks that a short prompt uses fewer tokens than a long prompt.",
  "prompt": "Read README.txt. Reply with one sentence.",
  "compare": {
    "a": {
      "label": "verbose",
      "description": "Asks for a long summary.",
      "prompt": "Read README.txt. Write a long summary."
    },
    "b": { "label": "short", "description": "Asks for one sentence." },
    "cheaper": "b"
  },
  "rubric": { "mustReadPath": ["README.txt"] }
}
```

```json
{
  "name": "docs quality cost",
  "description": "Checks that a skill arm uses fewer tokens than the matched no-skill arm.",
  "prompt": "Answer from the catalog.",
  "compare": {
    "arms": [
      {
        "id": "skel-clean",
        "label": "skeleton clean",
        "description": "Uses the skeleton skill on a clean catalog.",
        "workspace": "workspaces/skel-clean"
      },
      {
        "id": "none-clean",
        "label": "no skill clean",
        "description": "No skill on a clean catalog.",
        "workspace": "workspaces/none-clean"
      },
      {
        "id": "skel-messy",
        "label": "skeleton messy",
        "description": "Uses the skeleton skill on a messy catalog.",
        "workspace": "workspaces/skel-messy"
      },
      {
        "id": "none-messy",
        "label": "no skill messy",
        "description": "No skill on a messy catalog.",
        "workspace": "workspaces/none-messy"
      }
    ],
    "cheaper": [
      { "winner": "skel-clean", "loser": "none-clean" },
      { "winner": "skel-messy", "loser": "none-messy" }
    ]
  },
  "rubric": { "mustReadPath": ["README.txt"] }
}
```

Use separate workspaces when one arm has a skill and the other does not. Put `mustInvokeSkill` on the skill arm only. In-repo examples live under `agent-suites/judge`.

## MCP servers

Attach stdio or HTTP/SSE servers on suite defaults or on a scenario. Ambient project and user MCP configuration is not loaded.

```json
{
  "defaults": {
    "mcpServers": {
      "echo": {
        "type": "stdio",
        "command": "node",
        "args": ["packages/test/fixtures/mcp-echo/server.mjs"]
      }
    }
  }
}
```

`${VAR}` placeholders expand from the process environment. An unset variable fails the run.

When `workspace` is a subfolder, stdio MCP cwd is the caller repo. Script args stay caller-relative.

## Check before a live run

```bash
npx agent-test --check --suites-dir agent-suites
```

`--check` must pass before you spend host usage. Isolation rules for `workspace` and skills live in [isolation.md](isolation.md).
