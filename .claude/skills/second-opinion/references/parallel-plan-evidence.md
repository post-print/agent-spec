# Parallel Plan Evidence

Parallel evidence gathering for **second-opinion Stance A** (fresh read). Uses [`multi`](../../multi/SKILL.md) kernel — [non-negotiables](../../multi/SKILL.md#non-negotiables), [task-prompt.md](../../multi/references/task-prompt.md), [member-schema.md](../../multi/references/member-schema.md).

Profile: `plan`.

Stance B (verify / axis checklist) stays sequential — do not use this recipe.

## When to use

- Large `.plan.md`, PRD, or issue set (> ~150 lines or many cited paths)
- Plan spans multiple subsystems and single-pass skim risks missed dependencies
- User attached **multi** with second-opinion Stance A

## When to skip

- Small plan — coordinator reads plan + 2–4 cited files in one pass ([second-opinion.md](second-opinion.md))
- User wants completeness verify (Stance B) → [verify.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/verify.md)
- Dialogue without plan artifact → **crystallize** / **grill**

## Members (2–3)

| Slice                       | Focus                                                | Subagent                                                                                           | Notes                                                                                    |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Premises + scope            | Implicit goals, in/out of scope, acceptance criteria | `generalPurpose` + stance `premises`                                                               | Plan text only                                                                           |
| Dependencies + blast radius | Ordering, hidden deps, structural work               | `architecture` if HOST + `contexts` includes `plan`; else `generalPurpose` + stance `blast_radius` | Score on cited paths via [agent-discovery.md](../../multi/references/agent-discovery.md) |
| Cited code skim             | Validate plan claims against 2–4 top cited files     | `explore`                                                                                          | Fast tier                                                                                |

Extract `task_paths[]` from plan citations before scoring council agents.

## Dispatch plan template

```markdown
Task: Second-opinion Stance A — parallel evidence for [plan path]
Classification: mixed
Source of truth: plan
Goal: coverage

Parent model: [Auto | <named>]
User model overrides: [none | member=slug, …]
Auto reachable: [inherit-auto | model=auto | no]
Host supports: [Task model enum]
Billing pool: [first-party | API | mixed]
Explicit model slugs used: none
Fast variants used: none

Selected members:

- generalPurpose · tier=Standard · model=inherit-auto · stance=premises: premises + scope pass
- architecture · tier=Standard · model=inherit-auto · stance=blast_radius: dependencies + structural gaps (if available)
- explore · tier=Fast · model=inherit-auto · stance=n/a: skim [cited paths]

Synthesis plan: merge member reports; coordinator writes final Stance A sections
```

Prefer Auto for all members. Explicit model slugs require slice-fit + Cursor cost justification per [model-routing.md](../../multi/references/model-routing.md). Do not use `*-fast` in parallel.

Compose prompts per [task-prompt.md](../../multi/references/task-prompt.md).

## Synthesis

1. Merge member [member-schema](../../multi/references/member-schema.md) reports.
2. **Coordinator** (second-opinion author) writes final output per [second-opinion.md](second-opinion.md) — Premises, What's solid, Gaps, etc.
3. Multi supplies evidence; it does not replace the opinion structure.
4. Surface premise list for user confirmation before final sections when not already settled.

## Handoff

- Gaps found → user may run **verify** stance or **build** to fill in.
- Code hunch from cited skim → **investigate** on one target.
