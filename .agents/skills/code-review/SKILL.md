---
name: code-review
description: Multi-lens code review for PR, commit, unstaged, staged, merge, and implementation diffs. Default filing merge-blockers only; say "include improvements" for polish/tests/refactor. Dispatches council via parallel subagents; scannable finding-block output (output.md — not Cursor bugbot subagent). Use when reviewing code, checking a diff, analyzing changes, or the user asks for code review. Auto-detects mode when omitted.
---

# Code review

**Source of truth for** portable council code-review workflow.

<!-- doc-meta: owner=eng | last-reviewed=2026-07-15 -->

Consumer overlays arrive as project-specific injected context on skill read.

References: [council-dispatch.md](references/council-dispatch.md) · [agent-selection.md](references/agent-selection.md). Ambient routing extract → [agent-routing.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/agent-routing.md) § Pre-ship / PR.

## When to Use

- Review PR, commit, staged/unstaged, merge, or implementation diff
- Council dispatch with merge-blocker filing (default)
- Fix-loop / same-session implement after review

Not for: PR description/body authoring (separate skill), Cursor `/review-bugbot` or `/review-security` shortcuts (use this skill for fix-loop and worth-doing gate).

## Quick reference

| Need                            | Reference                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Modes, diff, depth, escalation  | [references/modes.md](references/modes.md)                                                                  |
| Default filing (merge-blockers) | [references/merge-blockers.md](references/merge-blockers.md)                                                |
| Council dispatch + spawn        | [references/council-dispatch.md](references/council-dispatch.md) · [`multi`](../multi/SKILL.md) kernel      |
| Agent selection                 | [references/agent-selection.md](references/agent-selection.md)                                              |
| Review synthesis                | [references/synthesis.md](references/synthesis.md)                                                          |
| Output                          | [references/output.md](references/output.md) — scannable finding-block shape (not Cursor `bugbot` subagent) |
| Fix-loop convergence            | [references/fix-loop-ledger.md](references/fix-loop-ledger.md) — stable themes, invariant matrix, exit gate |

## Workflow

1. **Anti-thrash preflight + mode + depth** — explicit or auto-detect mode ([modes.md](references/modes.md)). **Before any council dispatch**, run the [anti-thrash preflight](#anti-thrash-preflight). Apply pr/merge escalation, then calibrate fix-loop depth per [modes.md](references/modes.md) § Contextual re-review (targeted closure vs Full). When prior Action findings exist, reconstruct and carry the stable-theme ledger from [fix-loop-ledger.md](references/fix-loop-ledger.md); derive applicable invariant-matrix rows and each theme’s sweep plan before dispatch. **Filing mode:** default **merge-blockers only** ([merge-blockers.md](references/merge-blockers.md)) unless user said include improvements / full audit / hardening pass / polish / test inventory / exhaustive triggers. Record depth **and** pass class (`baseline` / `targeted` / `Full contextual`) in synthesis header per [output.md](references/output.md) § Status line.
2. **Diff** — per modes.md (`pr`/`merge` → [shared.md](references/shared.md)).
3. **Council dispatch (mandatory spawn)** — parallel council per [council-dispatch.md](references/council-dispatch.md) ([`multi`](../multi/SKILL.md) kernel) → [synthesis.md](references/synthesis.md) → [output.md](references/output.md).

   **Hard rules (do not skip):**
   - Issue **one host Task/Subagent call per selected member** (depth budget: Quick 1 / Standard 2 / Thorough 4 / Full 5; targeted closure uses Standard or Quick per modes.md — never zero). Coordinator `Read` / `Grep` / `Shell` is **not** a substitute for member runs.
   - Before writing any review report this turn: read [`multi` Non-negotiables](../multi/SKILL.md#non-negotiables) and [synthesis.md](references/synthesis.md). If no planned Task completed, **stop** — do not fabricate a `Review · …` report.
   - Docs / skills / agent-infra / “single theme” diffs do **not** waive council. Escalation path exclusions only affect Full promotion counts, not Thorough/Standard spawn. Targeted closure is a calibrated member budget, not a solo-coordinator waiver.
   - [`multi` Fit check](../multi/SKILL.md#fit-check) does **not** apply once this skill is running — this entry skill already chose parallel council.
   - **Mandatory before spawn:** append [task-prompt-review.md](references/task-prompt-review.md) § Default filing overlay to **every** member prompt (and coordinator plan). When consumer overlay context was injected on skill read, prefer that overlay set (Filing gate / product-intent / Baseline / Contextual Full) over portable `task-prompt-review.md` thinned sections alone. Missing injected overlay when one is configured = incomplete dispatch.

4. **Chat handoff** — when fix-loop applies: if fix pass, end with the updated ledger, validation evidence, and hotspot list. Re-review must reconcile every candidate to a stable theme and include **Baseline contradictions** when prior synthesis exists.

**Order when fix-loop applies:** council → synthesis → chat findings → handoff if fix pass → end turn.

**Merge gate (human):** Merge-ready / “final blockers” language is allowed only when the [fix-loop exit gate](references/fix-loop-ledger.md#exit-gate) passes. Zero findings alone is insufficient.

## Anti-thrash preflight

Run this before step 3 whenever the session has prior review output, prior Action findings, or recent fix commits on the same branch/PR:

1. **Detect repeated review** — same branch/thread as a prior `Review · …` pass, or user asked to re-review after fixes.
2. **Reconstruct the ledger** — rebuild the stable-theme table from prior synthesis / handoff ([fix-loop-ledger.md](references/fix-loop-ledger.md)). Do not reset closed themes.
3. **Classify the request** (record in the dispatch plan):
   - `first-baseline` — no prior Action findings for this diff/PR
   - `fix-implementation` — user asked to implement/address findings (not a re-review yet)
   - `closure-re-review` — re-review after fixes; diff only touches prior themes / their sweep surfaces
   - `new-scope-review` — re-review where scope expanded (new subsystems, new boundaries, ledger missing, or contradictions unresolved)
4. **Choose depth lane** — `closure-re-review` → prefer [targeted contextual re-review](references/modes.md#contextual-re-review) over another Full baseline council. Promote to Full when [modes.md](references/modes.md) Full triggers match. `new-scope-review` and first baselines follow normal escalation.
5. **Thrash signal** — if the prior pass filed **two or more** Action blockers in the same subsystem / theme family, do not spawn a symptom-hunting Full council. Require a [same-invariant sweep](references/fix-loop-ledger.md#same-invariant-sweep) for that family before filing more Action blocks.

**Routing:** PR description / body → separate authoring skill. Review / check / analyze → here.

## Consumer bindings

Project-specific injected context is appended on skill read. Do not edit synced copies in place.

**Fix implementation:** User "address all" / "fix all" / "yes" to ship-blockers → read prior synthesis and ledger before coding; implement invariant-complete theme batches; add regression evidence; run the repo’s authoritative validation lane; end with the updated ledger and hotspot handoff.

## Output format

Follow [output-schema.md](https://raw.githubusercontent.com/csark0812/toolbox/main/.skeleton/references/output-schema.md). Review findings use [references/output.md](references/output.md) — scannable finding blocks, synthesis header, Action vs Noted/Deferred tiers per [merge-blockers.md](references/merge-blockers.md).
