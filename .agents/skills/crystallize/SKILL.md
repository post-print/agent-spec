---
name: crystallize
description: Fuzzy idea → shaped intent. Socratic dialogue toward a crystallized concept — no solving, no plan yet. High follow-up density; warm, not harsh. Handoffs — plan file → second-opinion; code hunch → investigate; pressure-test → grill; serialize work → references/planning/build.md.
disable-model-invocation: true
---

# Crystallize

**Source of truth for** Socratic idea crystallization.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-13 -->

Shape a half-formed idea through dialogue. Before the first turn, read [dialogue-contract.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/dialogue-contract.md) (shared behavior) and [dialogue-handoffs.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/dialogue-handoffs.md) (routing).

Goal: **crystallization**, not resolution. Follow the thread; don't steer toward a conclusion. Incomplete or vague input is normal.

**Ambient routing:** mirror + one assumption check → [agent-routing.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/agent-routing.md) § Fuzzy intent; full crystallize remains user-paced dialogue.

## Example opening turn

> So you have something forming but it's not sharp yet — that's fine. In your own words, what's the rough shape of it, even if it's messy?

## Protocol

1. **Listen first.** Let the user describe whatever they have — incomplete, vague, or half-formed is fine. Don't ask for clarity before they've spoken.
2. **One cluster per turn** — one main question that opens the idea, plus **tight sub-parts only** when they unpack the _same_ uncertainty. A **second short question** in the same turn is OK when the first cannot be answered without it. No unrelated question dumps. For discrete choices (which thread to deepen, confirm/deny a mirror), use **AskQuestion** with **Other / I'll type it**; keep wide-open mirrors in chat.
3. **Reflect before asking.** Briefly mirror what you heard; validate uncertainty: "So part of this might still be fuzzy, but it sounds like…"
4. **Exhaust the branch.** Chain another question on the same branch before moving on. If an answer is **thin**, say so and ask which meaning fits.
5. **Before crystallizing:** Surface at least **one tacit assumption** as a gentle check ("I might be assuming X — does that fit?") **or** **one branch gently tested** — don't offer the final block until that exchange happened (unless the user asks to skip ahead).
6. **Follow energy, not logic.** If the user lights up on a tangent, go there.
7. **Don't solve.** Avoid proposing solutions, architectures, or implementations unless explicitly asked.
8. **Sharpen domain terms** against the project glossary as they resolve — dialogue does not own the glossary.
9. **Crystallize when ready.** When the idea has enough shape _and_ the gate above is satisfied, offer the crystallized statement below. Confirm with **AskQuestion** when possible.

## Question cadence

- Open up, don't close down.
- Good: "What would make this feel solved to you?" / "What's the part that feels most uncertain?" / "Where did this idea come from?"
- Avoid: "Have you considered X?" (steers) / "Why not just do Y?" (solves) / forced binary when the space is still open

## Exit condition

User confirms the crystallized statement or indicates they're done for now. If a major thread still feels implicit, **ask one more question** instead of crystallizing.

## Output format

Follow [output-schema.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/output-schema.md). End with this block when exit criteria are met — not before:

```markdown
## Crystallized idea

[2–4 sentence statement from the user's perspective. Reads like: "You're trying to X, because Y. The key tension is Z."]

## What remains open

- [Unresolved branches]

## Possible next steps

- Pressure-test the design → **grill** skill
- Fresh read of a plan on disk → **second-opinion**
- One concrete code doubt → **investigate**
- PRD or structured plan → [build.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/build.md)
```

## Consumer bindings

Project-specific injected context is appended on skill read. Do not edit synced copies in place.
