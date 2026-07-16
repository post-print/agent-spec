# Council Synthesis

Review-specific synthesis after council members return. Generic multi synthesis → [multi synthesis gate](../../multi/SKILL.md#synthesis-gate).

**Hard gate:** Do not write a `Review · …` findings report until **every SELECTED council member** has a completed host Task/Subagent run ([council-dispatch.md](council-dispatch.md) § Hard gate). Coordinator tool use is not a substitute. If spawn failed, the host cannot run Task, or the user declined council — say so and **stop**; do not emit synthesis-shaped output.

**Prerequisite:** One completed `Task` per SELECTED member (architecture optional-slot omit from [modes.md](modes.md) is the only member-level omit that still counts as a full council when the remaining SELECTED members ran). Broader “valid skips” → [multi non-negotiables](../../multi/SKILL.md#non-negotiables); Fit check does not apply under code-review.

After members return:

1. Merge findings that agree; state once with the highest shared confidence.
2. Group all symptoms and edge variants by root invariant. One invariant gets
   one stable `theme_id` and one Action block.
3. On pass 2+, reconcile every candidate against the prior ledger before
   deciding it is new: incomplete fix, same-invariant variant, genuinely new
   invariant, or non-blocking observation.
4. Same invariant + new edge on pass 2+ **extends** the existing `theme_id`
   (reopen / incomplete closure). Do not file a fresh sibling theme for an
   adjacent hole. Reject adjacent-variant Action blocks unless the text proves
   a genuinely different root invariant.
5. For every genuinely new Action theme on pass 2+, include a one-line
   `Prior-pass miss:` explanation in the finding description.
6. Before marking a theme closed, apply the applicable invariant matrix, run
   the theme’s [sweep plan](fix-loop-ledger.md#same-invariant-sweep), check
   affected contract surfaces, and record **variant coverage checked** per
   [fix-loop-ledger.md](fix-loop-ledger.md) § Variant coverage before closure.
7. If two or more Action candidates share a subsystem / theme family, apply the
   [thrash signal](fix-loop-ledger.md#thrash-signal): collapse to one theme and
   require a holistic sweep instead of shipping multiple symptom blocks.
8. **Apply worth-doing gate** (consumer worth-doing gate / customize) — demote failures to **Noted** or **Deferred** tails; never Action blocks.
9. Only **Action** items (ship-blocker or in-scope hardening) get severity and scope in synthesis.
10. Preserve conflicts among Action candidates; do not flatten them away.
11. On high-risk contradiction among Action items, spawn a neutral tiebreaker at **Premium** tier (still parent-aware: Auto parent → `inherit-auto` / omit `model`; named parent → explicit Premium slug per multi routing) or escalate to the user.
12. Update the ledger, hotspot review status, sweep-plan results, variant-coverage notes, test
    evidence, and validation evidence per [fix-loop-ledger.md](fix-loop-ledger.md).
13. Write consolidated report per [output.md](output.md). Header must state whether
    the pass stayed **targeted contextual** or promoted to **Full contextual**, with reason.

Fix-loop baseline comparison and **Baseline contradictions** section → consumer review-fix-loop / customize § Baseline comparison. Consumer rules may add context but cannot weaken stable theme identity or the portable exit gate.
