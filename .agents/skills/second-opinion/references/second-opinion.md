# Second opinion

Work on a **written** plan, PRD, or issue set — not Socratic explore. Pick a **stance**:

| Stance                      | When                                                                                                                                               | Where                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **A — Fresh read**          | Plan you had **no part** in creating; you want premise challenge + structured critique                                                             | This doc, below                                                                                               |
| **B — Completeness verify** | "Verify my plan", "did I miss anything", readiness on `.plan.md` / `docs/prds/` / issues; **axis checklist**, fixed report shape, does not rewrite | [verify.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/verify.md) |

**Both:** If you want outsider critique **and** the axis checklist, run **A then B**, or **B then A** if premises are already settled.

**Not in scope for either stance:** security/compliance review (use the **security** agent), reproducible broken behavior (**investigate** + **testing** + **debug** when layer or session logs unclear). For broad proactive codebase sweeps, use [parallel-explore.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/planning/parallel-explore.md).

**Stance A escalation tiers:** default single-pass (small plan) → coverage evidence-gather via [parallel-plan-evidence.md](parallel-plan-evidence.md) (large plan) → perspective adversarial via [parallel-perspective.md](parallel-perspective.md) (contested/high-stakes, on request).

---

## Stance A: Fresh read

You are reviewing a plan you had no part in creating. Approach it fresh — no deference to prior decisions.

### Workflow

1. **Read the plan file** — find it via `.cursor/plans/*.plan.md` or ask the user for the path or description.
2. **Read supporting context** — skim the 2–4 most relevant primary sources the plan cites — code files, docs, data, or prior research/decisions. Don't read everything; the plan should cite them.
3. **Pre-review assumption pass (before the full writeup).** Extract **3–6 implicit premises** the plan depends on (goals, constraints, owners, timelines, tech choices, “this API already works,” etc.). **Invite the user to confirm or correct** the **top 2–3** that would invalidate the review if wrong — short, invitational questions, not a cross-exam. If you cannot reach the user synchronously, present the premise list first and either pause for answers or label the rest of the opinion **provisional** until they respond.
4. **Analyze and respond** — apply the framework below, incorporating what the user confirmed or corrected.

**Blocking:** Do not present the full structured **Output Format** sections as final until critical premises are at least **surfaced** and the user has had a chance to react — _or_ they've told you to proceed without. If you must ship in one shot, lead with **## Premises (please confirm or correct)** and keep the rest explicitly provisional.

### Structural deepening and scope

Synced with [dialogue-contract.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/dialogue-contract.md) § Structural checks — plan-review depth here; do not duplicate bullets; update dialogue-contract if patterns change.

Briefly, where relevant — a short honest line in **Scope / complexity** or **Gaps**, not a second full audit:

- Does the plan **under-** or **over-** state structural / boundary work (consolidation, module moves, integration tests, coupling)?
- Should the plan add a **milestone** for boundary or orchestration work before or alongside feature work?
- **Local change** vs **staged or ground-up** — cite [dialogue-contract.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/dialogue-contract.md) patterns when naming the call.

### Analysis framework

Cover all of these, briefly. Skip sections where there is genuinely nothing to flag.

**What's solid** — name 2–3 things the plan gets right. Be specific, not flattering.

**Gaps** — missing steps, unaddressed cases, or work the plan assumes will "just happen."

**Hidden dependencies** — steps that must complete before others can start, but aren't ordered or noted as such.

**Risky assumptions** — things the plan treats as given that could easily be wrong (env config, external APIs, backward compat, test coverage, etc.).

**Scope / complexity** — is the plan undersized (misses real work) or oversized (gold-plating)? Name which.

**Concrete suggestions** — for each issue raised, give the specific change to the plan. Don't just identify problems.

### Output format

```
## Premises (if not already settled in-thread)

- [Premise 1]
- [Premise 2]
- ...

## What's solid
...

## Gaps
...

## Hidden dependencies
...

## Risky assumptions
...

## Scope / complexity
[Include structural / deepening notes here when the lens applies — one short paragraph or bullets, not a full audit.]

## Recommended additions to the plan
- ...
```

### Principles

- Honest and objective. No softening language ("this is a great plan, but...").
- Cite specific file paths and line numbers from the plan when raising concerns.
- If the plan is genuinely complete, say so — don't manufacture criticism.
- Flag things the original author likely overlooked because they were too close to the problem.
- **Tone:** Direct on the work; never harsh toward the person holding the plan.
