# Agent Discovery

Mechanical steps for discovering workspace council agents and intersecting with the host Task tool. **Selection scoring** (review depth, diff paths, plan keywords) lives in entry-skill recipes — e.g. [code-review agent-selection.md](../../code-review/references/agent-selection.md) for review.

Used by [`multi`](../SKILL.md) and entry-skill recipes that optionally spawn council agents.

## Discovery steps

```
1. DISCOVER ← parse frontmatter of every `.claude/agents/*.md` (name, description, dispatch)
2. HOST ← read Task tool subagent_type enum from host
3. AVAILABLE ← { agent.name | agent in DISCOVER, agent.dispatch.kind ≠ skip, agent.name ∈ HOST }
4. CONTEXT_FILTER ← exclude agents whose dispatch.contexts does not include active profile
                     (default [review] when omitted; manual/web may name agents explicitly)
5. If SELECTED empty after entry-skill scoring → fallback: host built-in subagent_type + slice in Task prompt
```

## Dispatch metadata (agent frontmatter)

Each `.claude/agents/*.md` file may declare:

```yaml
dispatch:
  kind: council # council | skip — skip = never auto-dispatch
  contexts: [review, repo, plan] # default [review] when omitted
  priority: 90 # tie-breaker when filling optional slots (higher first)
  depth:
    eligible: [standard, thorough, full]
    required_from: standard # always spawn when depth >= this (review only)
  path_trigger: true # also spawn when paths/keywords match
  paths: # prefix match on task paths
    - <backend-or-api-root>/
  path_globs: # glob match (e.g. **/*.tsx)
    - '**/*.tsx'
  keywords: # case-insensitive match in diff or plan body
    - openapi
  model:
    default: standard # fast | standard | premium
    premium_when: [thorough_or_full, ...]
  stances: [lens_id, ...] # pick one per member for perspective diversity
```

**Legacy agents** without `dispatch:` — treat as `kind: council`, `contexts: [review]`, tier `standard`.

**Operational agents** (standalone audit paths) — set `kind: skip`; coordinator does not auto-select.

## Path and keyword matching

Shared helpers for entry-skill recipes that score agents:

- **Path prefix:** task path starts with entry in `dispatch.paths` (normalize trailing `/`).
- **Glob:** match task path against `dispatch.path_globs` (standard glob semantics).
- **Keyword:** substring in diff or plan body (case-insensitive); avoid ultra-common tokens.

### Plan path extraction

Coordinator reads plan/PRD file and collects:

- Backtick paths (`<app-or-package>/...`, `docs/...``)
- Markdown links to repo files
- Explicit "see `path`" citations

Pass as `task_paths[]` to entry-skill scoring.

## Model tier from agent metadata

Agent `dispatch.model.default` and `premium_when` are **tier metadata**, not spawn instructions.

1. Resolve the member model with [multi routing precedence](../SKILL.md#routing-precedence-canonical-order) and validate it with the [pre-spawn gate](../SKILL.md#pre-spawn-model-routing-gate).
2. Under an Auto parent without a user override, metadata stays informational: plan `model=inherit-auto` and omit the tool `model` argument.
3. Tier→slug mapping is only for the named-parent branch; when it applies, use [model-routing.md](model-routing.md) for cost/fit and anti-fast rules.
4. Usage-limit start/stop failures use [multi usage-limit retry](../SKILL.md#usage-limit-retry).

## Availability log (required in dispatch plan)

Before spawning, log:

```markdown
Profile: [review / repo / plan / manual / web — from entry-skill recipe]
Discovered: [all agent names from .claude/agents/]
Host supports: [subagent_type enum]
Host model enum: [Task model enum — never invent slugs]
Parent model: [Auto | <named model>]
User model overrides: [none | member=slug, …]
Auto reachable: [inherit-auto | model=auto | no]
Billing pool: [first-party | API | mixed]
Available: [intersection after context filter]
Depth: [depth or n/a] · Budget: [N or n/a]

Required: [agent — reason]
Optional selected: [agent — score, matched paths/keywords]
Skipped: [agent — not eligible | wrong context | below threshold | not in HOST]
Fallbacks: [built-in type chosen when council agent unavailable]
Explicit model slugs used: [none | slug + slice-fit reason + cost note]
Fast variants used: [none | slug + explicit latency reason]
```

## Adding a new council agent

1. Add `.claude/agents/<name>.md` with body + `dispatch:` frontmatter (include `contexts` when useful outside review).
2. Ensure host Task tool lists `<name>` as a valid `subagent_type` (or use a built-in type and put the lens in the Task prompt).
3. No skill table updates required.
