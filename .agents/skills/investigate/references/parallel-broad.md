# Parallel Broad Investigate

Wide fish when the user explicitly asks for a broad pass. Uses [`multi`](../../multi/SKILL.md) kernel — [non-negotiables](../../multi/SKILL.md#non-negotiables), [task-prompt.md](../../multi/references/task-prompt.md), [member-schema.md](../../multi/references/member-schema.md).

Profile: `repo`.

Default **investigate** stays single-target — use this recipe only on explicit user request.

## When to use

- User says "fish broadly", "check the whole subsystem", or names multiple areas without a single file target
- Hunch spans wiring across client + backend + shared packages

## When to skip

- Specific file, hook, or endpoint named — standard **investigate** protocol
- Plan evidence pass — [parallel-plan-evidence.md](../../second-opinion/references/parallel-plan-evidence.md)
- Code review — **code-review**

## Members (2–3)

Split by subsystem:

| Slice                 | Subagent                      | Tier |
| --------------------- | ----------------------------- | ---- |
| Area A (e.g. client)  | `explore` or `generalPurpose` | Fast |
| Area B (e.g. backend) | `explore` or `generalPurpose` | Fast |
| Shared / integration  | `explore`                     | Fast |

Optional: score council agents on known paths — prefer `correctness` for mutation/cache paths if `contexts` includes `repo`. Path matching → [agent-discovery.md](../../multi/references/agent-discovery.md).

## Dispatch plan template

```markdown
Task: Broad investigate — [user-stated hunch]
Classification: explore
Source of truth: repo
Goal: coverage
Parent model: [Auto | <named model>]
User model overrides: [none | member=slug, …]

Selected members:

- explore · tier=Fast · model=[inherit-auto | slug] · stance=n/a: [client slice — hypothesis to test]
- explore · tier=Fast · model=[inherit-auto | slug] · stance=n/a: [backend slice]

Synthesis plan: merge evidence; verdict per investigate schema (Confirmed / Refuted / Partial)
```

## Synthesis

1. Merge findings with file:line citations.
2. Write **investigate** verdict — Confirmed / Refuted / Partial — with evidence from all members.
3. Conflicting member conclusions → state both; escalate or narrow target.
4. Output follows **investigate** skill final shape; use [multi output-format.md](../../multi/references/output-format.md) sections only as supporting detail.

## Handoff

- Verdict Refuted / narrow → close or single-target **investigate**
- Reproducible bug → **testing**
- Reproducible bug needing session logs (NDJSON, compose mount) → **debug**
