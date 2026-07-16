---
name: grill
description: Design-tree alignment before implementation. Joint sense-making — persist until major branches resolve; repo-first. Handoffs — still fuzzy → crystallize; plan file → second-opinion; serialize → references/planning/build.md.
disable-model-invocation: true
---

# Grill

**Source of truth for** design-tree alignment before implementation.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

Pressure-test a design before code. Before the first turn, read [dialogue-contract.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/dialogue-contract.md) (shared behavior) and [dialogue-handoffs.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/dialogue-handoffs.md) (routing).

Shared understanding before implementation. **Persist** with patient follow-up until every major branch is resolved — design-tree interview framed as **joint sense-making**, not cross-examination.

## Example opening turn

> I'll walk the design tree with you — one branch at a time until we're aligned. What's the decision or plan you want to pressure-test first?

## Protocol

1. **Persist until alignment** on every aspect that matters for implementation. Don't imply the user should already have all answers.
2. **Walk the design tree** — each choice branches; resolve dependencies before committing to a path.
3. **Explore the codebase instead of asking** — if a question can be answered by searching or reading the repo, do that first.
4. **One branch at a time; exhaust it.** No unstructured question lists across unrelated topics. **Chained follow-ups** on the same branch until settled. When branches are explicit, prefer **AskQuestion** for the choice; mirror/context in prose above the card.
5. **Test assumptions with the user** — "If X weren't true, would this still make sense?"
6. **Falsifiers on the record** — for major choices, what would show a branch was the wrong bet?
7. **Sharpen domain terms** against the project glossary as they resolve — grill does not own the glossary.
8. **Don't stop early.** Every major branch resolved, not just the happy path.

## Design tree

At each decision node:

- What are the branches here?
- Which branch are we taking, and why?
- What does that branch depend on? (Resolve those first.)
- What would show this branch was the wrong bet?

Repeat until no unresolved branches remain.

## When to stop

- Every significant design choice made explicitly
- Dependencies between decisions resolved in order
- No major "what if X doesn't hold?" questions unanswered _with the user_
- User can describe the plan without ambiguity (or accepts documented open questions)

If almost there, **ask the next question** instead of summarizing prematurely.

## Integration

- **planning/build.md** — if the user just finished grill, skip redundant clarification there (Step 4).
- **Repo exploration for a branch** — optional [parallel-explore.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/parallel-explore.md) via **multi** when a design branch depends on repo facts; grill stays dialogue-first.
- **Ambient routing** — inline extract (branches, deps, falsifier) → [agent-routing.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/agent-routing.md) § Before implement; full grill remains user-paced.

## Output format

Follow [output-schema.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/output-schema.md). End with this block when **When to stop** criteria are met — not before:

```markdown
## Decisions reached

- [Decision 1]: [What was decided and why]
- [Decision 2]: [What was decided and why]

## Open questions (deferred)

- [Anything explicitly punted]

## Next step

- Ready to implement → [build.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/build.md) (then [code-review](../code-review/SKILL.md) once code exists)
- Written plan for external read → [second-opinion](../second-opinion/SKILL.md)
- One concrete code doubt → [investigate](../investigate/SKILL.md)
- Still fuzzy on intent → **crystallize** skill
```

## Consumer bindings

Project-specific injected context is appended on skill read. Do not edit synced copies in place.
