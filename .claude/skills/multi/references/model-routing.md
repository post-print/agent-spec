# Model Routing

Cost-aware model selection for [`multi`](../SKILL.md). Optimize for **cheapest good enough**, not most capable by default. Escalate only when slice shape or evidence requires it — and then to the **most appropriate** stronger model, not the most expensive one.

Inspect the current host Task `model` enum before every dispatch. Never invent slugs.

## Source tiers

| Tier            | Meaning                                                     | Use as                                          |
| --------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| **Primary**     | Vendor/host docs (Cursor, OpenAI, Anthropic, xAI, Moonshot) | Pricing pools, effort semantics, product intent |
| **Independent** | Artificial Analysis and similarly harnessed public evals    | Relative escalation signals among families      |
| **Vendor-only** | Self-reported benches without independent replication       | Soft signals only; never sole routing reason    |

Primary sources: [Cursor models & pricing](https://cursor.com/docs/models-and-pricing), [Cursor subagents](https://cursor.com/docs/subagents.md), [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort), [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning), [Composer 2.5](https://cursor.com/blog/composer-2-5), [GPT-5.6](https://openai.com/index/gpt-5-6/), [GPT-5.3 Codex](https://openai.com/index/introducing-gpt-5-3-codex/), [Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5), [Grok 4.5](https://docs.x.ai/developers/grok-4-5), [Kimi K2.7 Code](https://www.kimi.com/resources/kimi-k2-7-code). Independent: [AA Composer 2.5](https://artificialanalysis.ai/articles/cursor-composer-2-5-coding-agent-index), [AA GPT-5.6](https://artificialanalysis.ai/articles/gpt-5-6-has-landed).

## Cursor cost model

Apply **before** capability fit when any explicit slug is under consideration.

| Factor                | Rule                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **First-party pool**  | Auto, Composer 2.5, Grok 4.5 — Cursor documents significantly more included usage than named API models                         |
| **API pool**          | Named third-party/API models billed at API rates — use only when Auto/cheaper first-party paths are unavailable or insufficient |
| **Throughput `fast`** | Same intelligence, higher token price for lower latency (Composer Fast ≈ 6× token price for roughly no intelligence gain)       |
| **Reasoning effort**  | low / medium / high / xhigh / max changes thinking/tool token spend and quality — orthogonal to throughput `fast`               |

**Selection order**

1. Can Auto handle this slice? → use Auto.
2. Else → cheapest available model still likely good enough for the slice.
3. Else → escalate to the **most appropriate** stronger model for the slice (strength cards below), not the highest-priced enum entry.

Do not pick a model only because it has a high benchmark score.

## Auto reachability

**Invariant:** `Parent model = Auto` + no user model override ⇒ omit Task/Subagent `model`. `inherit-auto` is a plan sentinel only — never translate it into an explicit slug. Tier→slug mapping runs only after confirming the parent is **named**.

| Parent    | Task enum has `auto` | Member `model`             | Log                  |
| --------- | -------------------- | -------------------------- | -------------------- |
| **Auto**  | n/a                  | **Omit** `model` (inherit) | `inherit-auto`       |
| **Named** | yes                  | Pass `model=auto`          | `model=auto`         |
| **Named** | no                   | **Cannot reach Auto**      | `Auto reachable: no` |

**Cost-controlled `N ≥ 2`:** If Auto is unreachable (named parent, no `auto` in enum), **stop** and ask the user to switch the parent chat to Auto. Do not silently assign explicit paid/API slugs. User-named models still win; record the override.

**Plan vs tool:** `model=inherit-auto` in the plan → omit `model` on the tool call. `model=<slug>` in the plan → pass `model="<slug>"` only if the slug is in the host enum.

Bracket forms such as `composer-2.5[fast=false]` are documented for subagent frontmatter but may be rejected by live Task calls unless present in the enum. Never invent them in Task calls.

## Effort vs fast

| Control              | Controls                            | Parallel rule (`N ≥ 2`)                                        |
| -------------------- | ----------------------------------- | -------------------------------------------------------------- |
| **Reasoning effort** | Thinking/tool depth and token spend | low for mechanical; medium default; high for single escalation |
| **Throughput fast**  | Latency only (same intelligence)    | **Do not use** `*-fast` unless user explicitly wants latency   |

High-fast bundles (`gpt-5.3-codex-high-fast`, `cursor-grok-4.5-high-fast`) are **sequential escalations only**.

Effort guidance:

- **Low** — mechanical lookup, narrow gather, classification
- **Medium** — default for parallel members that need some reasoning
- **High** — single-member adjudication, complex debugging, harder architecture
- **Xhigh/max** — sequential escalation only when stakes justify it

## Strength cards

When a slice needs more than Auto, assign the most appropriate stronger model.

| Model / path                          | Best at                                                                                      | Weak / caveats                                                              | Escalate here when                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Auto**                              | Cost-efficient routing; balances intelligence, cost, reliability (Cursor primary docs)       | No fixed public bench profile; unreachable from named parent without `auto` | Default for all normal slices                                                     |
| **Regular Composer 2.5**              | Cursor-native long-horizon coding; complex instructions; strong cost/task                    | Often absent from Task enum; coding-specialized                             | Repo/coding delegate when Auto unavailable and regular Composer is selectable     |
| **`composer-2.5-fast`**               | Same intelligence as regular Composer, lower latency                                         | ≈6× token price; wasteful in parallel batches                               | Interactive `N = 1` only, with explicit latency justification                     |
| **Grok 4.5 (non-fast)**               | Coding, agentic/terminal work; first-party pool when exposed                                 | High-fast bundles expensive; not frontier on every SWE bench                | Terminal-heavy first-party work when Auto unavailable and non-fast Grok exists    |
| **`cursor-grok-4.5-high-fast`**       | Strong terminal/agentic when bundled high+fast is worth cost                                 | Expensive high-fast; poor parallel default                                  | Sequential terminal/debug escalation only                                         |
| **`gpt-5.6-luna-*`** (if exposed)     | Cheapest GPT-5.6 tier; high-volume lower-stakes work                                         | Weaker than Sol on hardest coding/reasoning                                 | Cheap API fallback for mechanical/low-stakes when Auto unavailable                |
| **`gpt-5.6-terra-medium`**            | Balanced GPT-5.6; moderate reasoning and coding-agent performance                            | Weaker than Sol on hard review; not always Pareto-best vs Luna/Sol          | Moderate integration/synthesis when cheaper paths likely insufficient             |
| **`claude-sonnet-5-thinking-medium`** | Agentic follow-through; brownfield debug; adjudication; tool/terminal use                    | API-pool cost; below Opus on hardest science/reasoning                      | Conflicting members, ambiguous adjudication, sustained agentic explore            |
| **`gpt-5.3-codex-high-fast`**         | Long agentic coding; terminal; interactive steering; computer-use loops                      | Expensive high-fast; weaker than Sonnet on some repo-reasoning benches      | Sequential long-horizon implementation/debug when cheaper coding paths fail       |
| **`gpt-5.6-sol-medium`**              | Hardest GPT-5.6 reasoning; coding-agent index leader; polish for knowledge/architecture work | Highest GPT-5.6 cost; overkill for mechanical slices                        | Architecture blast radius, synthesis tiebreaker, deepest-analysis request         |
| **`kimi-k2.7-code`**                  | Long-horizon coding; 256K context; MCP/tool workflows                                        | Thinking always on; vendor-heavy benches; not cheapest mechanical worker    | Large-context coding, open-weight, or Kimi tool workflows when cheaper paths fail |

## Escalation by slice shape

Use after Auto is ruled out or explicitly declined.

| Slice shape                       | Cheapest likely fit              | Most appropriate escalation                                                  |
| --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Mechanical explore/gather         | Auto                             | Luna / cheapest exposed API only if Auto unavailable and user accepts spend  |
| Repo map / coding delegate        | Auto → regular Composer 2.5      | Sonnet 5 medium (harder brownfield); Codex (long tool-driven implementation) |
| Web/docs research                 | Auto                             | Mid-tier API or Sonnet only if synthesis/conflict risk is material           |
| Terminal-heavy work               | Auto → first-party Grok non-fast | Grok high-fast or Codex as sequential escalation only                        |
| Conflicting member outputs        | Single tiebreaker; Auto first    | Sonnet 5 medium for adjudication; Sol for architecture-level contradiction   |
| Architecture blast radius         | Single sequential member         | Sol medium                                                                   |
| Long-horizon implementation/debug | Auto or regular Composer         | Codex high-fast only if cheaper coding paths fail and user accepts cost      |

## Diversity

Never escalate price or choose `fast` just to diversify. Diversify prompts and/or stances first. Shared Auto across members is expected and correct.

## Anti-patterns

- Premium / Sol / Codex for mechanical grep or narrow file discovery
- `composer-2.5-fast` (or any `*-fast`) as the default for parallel Standard members
- High-fast bundles in `N ≥ 2` parallel dispatch
- Inventing `auto`, `composer-2.5`, or bracket forms absent from the host enum
- Choosing the most expensive model when a cheaper appropriate one fits the slice
- Omitting `model` under a named parent and claiming Auto inheritance
- Silencing cost-controlled parallel runs onto API-pool slugs when Auto is unreachable
- Recording `Parent model: Auto` then passing any explicit Task `model` without a user override (including Premium-tier members)
- Translating plan sentinel `inherit-auto` into an arbitrary slug such as `gpt-5.3-codex-high-fast`
- Letting tier metadata or model diversity override an Auto parent

## Example dispatches (validation)

### A. Correct — Auto parent (omit `model`, even for Premium)

Dispatch plan:

```markdown
Parent model: Auto
User model overrides: none
Auto reachable: inherit-auto
Host supports: [explore, docs-researcher, generalPurpose, …]
Billing pool: first-party
Explicit model slugs used: none
Fast variants used: none

Selected members:

- reviewer · tier=Premium · model=inherit-auto · stance=correctness
- docs-researcher · tier=Standard · model=inherit-auto · stance=n/a: topic A
- explore · tier=Fast · model=inherit-auto · stance=n/a: repo map for cited APIs
```

Spawn call conceptually (every member):

```text
Task/Subagent(
  subagent_type="...",
  prompt="..."
)
```

There is **no** `model` argument, even though a member’s metadata says Premium. Expected: omit `model` on all Tasks; no `*-fast`; no API slugs.

### B. Incorrect — Auto parent with an explicit slug

```markdown
Parent model: Auto

- reviewer · tier=Premium · model=gpt-5.3-codex-high-fast
```

**Invalid** unless the user explicitly requested that model for the member. Pre-spawn gate must fail closed: correct to `model=inherit-auto` and omit the tool argument. Do not “fix” by swapping to Composer or another slug.

### C. Correct — named parent (tier routing after Auto ruled out)

```markdown
Parent model: <named model>
User model overrides: none
Auto reachable: no

- reviewer · tier=Standard · model=composer-2.5-fast
```

The explicit slug is selected using named-parent tier-routing rules **and** only if it exists in the host enum. Prefer non-fast / cheapest good enough when available; `*-fast` still requires an explicit latency reason for `N ≥ 2`.

### D. Correct — explicit user override under Auto parent

```markdown
Parent model: Auto
User model overrides: reviewer=gpt-5.3-codex-high-fast

- reviewer · tier=Premium · model=gpt-5.3-codex-high-fast
```

This explicit model is valid because the user requested it and the host enum supports it. Unsupported overrides → report; do not substitute.

### E. Correct — usage-limit retry

Initial named-parent dispatch uses an explicit model and fails due to quota or rate limits. Retry the **same** member with the same prompt, type, and stance, but omit `model` (or pass `model=auto` when that enum value is how Reach Auto works) to use Auto inheritance.

### F. Named parent, `auto` absent from enum — cost-controlled `N ≥ 2`

```markdown
Parent model: claude-sonnet-5-thinking-medium
Auto reachable: no
Host supports: [composer-2.5-fast, gpt-5.6-terra-medium, …] # no auto
```

Expected: **stop**; ask user to switch parent to Auto; do not spawn paid/API slugs for a cost-controlled parallel batch.

### G. Sequential Premium escalation (named parent or user override only)

```markdown
Parent model: <named model>
N = 1 (sequential tiebreaker)
User model overrides: none
Explicit model slugs used: claude-sonnet-5-thinking-medium — adjudication of conflicting member outputs; API pool accepted
Fast variants used: none
```

Expected: single Task with explicit Sonnet medium when parent is named (or user override). Under an Auto parent without a user override, the tiebreaker still uses `inherit-auto` / omit `model` — do not invent a Premium slug to “force” strength.
