# Task Prompt Template

Each member Task `prompt` is composed by the coordinator — subagents do not receive the full user thread or the `multi` skill.

Review overlays → [code-review/references/task-prompt-review.md](../../code-review/references/task-prompt-review.md).

**Model is not part of the prompt body.** Resolve `model` on the Task/Subagent call per [multi Model assignment](../SKILL.md#model-assignment): plan `model=inherit-auto` → omit the tool `model` argument; plan `model=<slug>` → pass that slug only when present in the host enum.

## Generic template

```
Member [k]/[N] · [job_type] · stance=[stance_id or n/a]

Sub-task: [slice only — not the whole job]

Source:
[file paths / web topic / repo area]

Output: follow [member-schema.md](member-schema.md)

Constraints:
- Do not assume other members' conclusions.
- Return only your perspective; coordinator synthesizes.
```

## Job types

| Job        | Sub-task focus                                     |
| ---------- | -------------------------------------------------- |
| `explore`  | Area, subsystem, or artifact to map                |
| `gather`   | Single source of truth to collect                  |
| `research` | Independent web topic                              |
| `mixed`    | One slice per member; no cross-member dependencies |

Job recipes → entry skill references (arrive as project-specific injected context on skill read).

## Perspective diversity

When `N ≥ 2` members share the same `subagent_type`, assign distinct `stance` values from the agent's `dispatch.stances` (or define ad hoc stances). Never use identical `model` + identical prompt for parallel members. Shared Auto inherit (`inherit-auto` / omit tool `model`) is fine when prompts/stances differ — do not pick distinct slugs under an Auto parent just to diversify.
