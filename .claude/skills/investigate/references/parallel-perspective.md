# Parallel Perspective Investigate

Adversarial stress-test when evidence is mixed or the user explicitly asks. Uses [`multi`](../../multi/SKILL.md) kernel — [non-negotiables](../../multi/SKILL.md#non-negotiables), [task-prompt.md](../../multi/references/task-prompt.md), [member-schema.md](../../multi/references/member-schema.md).

Profile: `mixed`.

Default **investigate** stays single-target, single-pass — use this recipe only when evidence is genuinely contested or the user requests a stress test.

## When to use

- User explicitly asks for a stress-test on a hunch
- Evidence gathered so far is genuinely mixed or contested — not a mild uncertainty

## When to skip

- Single-target hunch with a clear next read — standard **investigate** protocol
- Multiple independent topics — [parallel-research.md](parallel-research.md)
- Broad fish without a single target — [parallel-broad.md](parallel-broad.md)
- Plan review — **second-opinion**

## Members (2)

Same target — adversarial stances:

| Slice                        | Subagent         | Stance                                                              |
| ---------------------------- | ---------------- | ------------------------------------------------------------------- |
| Strongest case for the hunch | `generalPurpose` | `steelman` — assume the hunch is real; build the strongest case     |
| Mechanism that prevents it   | `generalPurpose` | `skeptic` — assume it's a non-issue; find what prevents the problem |

Use distinct stances. Under an Auto parent, share `inherit-auto` (omit tool `model`); diversify via prompts/stances, not slugs. Distinct explicit models only under a named parent (same tier) or recorded user overrides.

## Dispatch plan template

```markdown
Task: Perspective investigate — [one-line hunch]
Classification: mixed
Source of truth: [repo | plan | docs | data]
Goal: coverage
Parent model: [Auto | <named model>]
User model overrides: [none | member=slug, …]

Selected members:

- generalPurpose · tier=Standard · model=[inherit-auto | slug] · stance=steelman: strongest case for hunch
- generalPurpose · tier=Standard · model=[inherit-auto | slug] · stance=skeptic: mechanism that prevents or refutes

Synthesis plan: preserve conflicts per multi synthesis gate; verdict per investigate schema if evidence allows
```

## Synthesis

1. Merge findings per [multi synthesis gate](../../multi/SKILL.md#synthesis-gate) — **preserve conflicts; do not flatten disagreements.**
2. State both sides if genuinely split rather than averaging into "it's complicated."
3. Write **investigate** verdict — Confirmed / Refuted / Partial — when primary material supports one; if stances remain split, say so explicitly in verdict reasoning.
4. Output follows **investigate** skill final shape; use [multi output-format.md](../../multi/references/output-format.md) sections only as supporting detail.

## Handoff

- Verdict Refuted / narrow → close or single-target **investigate**
- Reproducible bug → **testing**
- Reproducible bug needing session logs (NDJSON, compose mount) → **debug**
