---
name: second-opinion
description: Written plan review — fresh read (Stance A) or completeness verify (Stance B). Not for dialogue without a plan artifact or a single code-path hunch.
disable-model-invocation: true
---

# Second opinion

**Source of truth for** written plan review.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

You are not having a Socratic **explore** session — the artifact is a **plan** (or PRD / issue set). Follow [references/second-opinion.md](references/second-opinion.md) for **stance dispatch** (fresh read vs completeness verify).

## When to Use

- Written plan on disk, `.cursor/plans/*.plan.md`, PRD, or issue set
- "Second opinion", "did I miss anything", freshness or completeness pass

Not for: dialogue without a plan ([`crystallize`](../crystallize/SKILL.md), [`grill`](../grill/SKILL.md)), single code-path hunch ([`investigate`](../investigate/SKILL.md)).

## Stances

| Stance                      | Trigger                                                  | Recipe                                                                                                        |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **A — Fresh read**          | Someone else's plan; premise challenge + critique        | [references/second-opinion.md](references/second-opinion.md) (Stance A)                                       |
| **B — Completeness verify** | "Verify my plan", readiness, axis pass without rewriting | [verify.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/verify.md) |

If unclear: ask whether they want a **fresh read** (outsider assumptions) or a **completeness checklist** (verify).

**Does not own:**

- Dialogue without a plan artifact → **crystallize** or **grill**
- Author a new plan from intent → **crystallize** or **grill** → [build.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/build.md)
- Single code-path hunch with evidence → **investigate**
- Stance dispatch and structural checks → [references/second-opinion.md](references/second-opinion.md)

## Stance and repo

- **Primary-source-first:** Skim 2–4 primary sources the plan cites — code files, docs, data, or prior decisions; do not ask the user for paths that appear in the plan (for **Stance A**; **Stance B** follows verify.md locate step).
- For structural “worth deepening?”, use the checklists in [references/second-opinion.md](references/second-opinion.md) — brief, not a second full pass. Broad codebase sweeps → [parallel-explore.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/parallel-explore.md). Stance A escalation: small plan → single pass; large plan → [parallel-plan-evidence.md](references/parallel-plan-evidence.md); contested/high-stakes → [parallel-perspective.md](references/parallel-perspective.md).
- If the user's need is only dialogue (no plan file), use **crystallize** or **grill**. If they need a verdict on a **single** suspicion, use **investigate**. To **author** a new plan from intent, use **crystallize** or **grill** → [build.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/build.md).

**Ambient routing:** inline axis pass on artifacts → [agent-routing.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/agent-routing.md) § Plan on disk; full Stance A/B remains user-invoked.

## Consumer bindings

Plan artifact paths (`.cursor/plans/`, ClickUp tasks, etc.) arrive as project-specific injected context on skill read. Do not edit synced copies in place.

## Output format

Follow [output-schema.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/output-schema.md). End with this block when the review pass is complete:

```markdown
## Second opinion summary

**Stance:** A (fresh read) | B (completeness verify)
**Artifact:** [path or title]

### Findings

- [Critical gap or assumption — or "No material gaps"]

### Recommended next steps

- [Concrete action: implement, revise plan, pressure-test → **grill**, serialize → planning/build.md, investigate code path → **investigate**]
```
