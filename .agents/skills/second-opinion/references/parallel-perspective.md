# Parallel Perspective Second Opinion

Adversarial stress-test for **second-opinion Stance A** (fresh read). Uses [`multi`](../../multi/SKILL.md) kernel — [non-negotiables](../../multi/SKILL.md#non-negotiables), [task-prompt.md](../../multi/references/task-prompt.md), [member-schema.md](../../multi/references/member-schema.md).

Profile: `plan`.

Default Stance A stays single-pass — use this recipe only for contested/high-stakes plans or when the user explicitly wants a stress test beyond the default fresh read.

## When to use

- Contested or high-stakes plan where premises or scope are genuinely disputed
- User explicitly wants a stress test beyond the default single-pass fresh read

## When to skip

- Small plan — coordinator reads plan + cited primary sources in one pass ([second-opinion.md](second-opinion.md))
- Large plan needing coverage split only — [parallel-plan-evidence.md](parallel-plan-evidence.md)
- Completeness verify (Stance B) → [verify.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/verify.md)
- Dialogue without plan artifact → **crystallize** / **grill**

## Members (2)

Same plan text — adversarial stances:

| Slice                       | Subagent         | Stance                                                                      |
| --------------------------- | ---------------- | --------------------------------------------------------------------------- |
| Strongest case for the plan | `generalPurpose` | `defend` — assume premises are right; build the strongest case for the plan |
| Where the plan breaks       | `generalPurpose` | `attack` — assume it's flawed; find where it breaks                         |

Use distinct stances. Under an Auto parent, share `inherit-auto` (omit tool `model`); diversify via prompts/stances, not slugs. Distinct explicit models only under a named parent (same tier) or recorded user overrides.

## Dispatch plan template

```markdown
Task: Second-opinion Stance A — perspective stress test for [plan path]
Classification: mixed
Source of truth: plan
Goal: coverage
Parent model: [Auto | <named model>]
User model overrides: [none | member=slug, …]

Selected members:

- generalPurpose · tier=Standard · model=[inherit-auto | slug] · stance=defend: strongest case for plan
- generalPurpose · tier=Standard · model=[inherit-auto | slug] · stance=attack: flaws, gaps, risky assumptions

Synthesis plan: preserve disagreement in Gaps / Risky assumptions; coordinator writes final Stance A sections
```

## Synthesis

1. Merge member [member-schema](../../multi/references/member-schema.md) reports per [multi synthesis gate](../../multi/SKILL.md#synthesis-gate) — **preserve conflicts; do not flatten disagreements.**
2. **Coordinator** writes final output per [second-opinion.md](second-opinion.md) — preserve split views in **Gaps** and **Risky assumptions** rather than merging or reranking stances.
3. Mirrors code-review's "don't let one axis mask the other" — applied across defend/attack stances instead of Standards/Spec.
4. Surface premise list for user confirmation before final sections when not already settled.

## Handoff

- Gaps found → user may run **verify** stance or **build** to fill in.
- Code hunch from cited material → **investigate** on one target.
